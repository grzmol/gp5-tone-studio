// WebMIDI transport for the Valeton GP-5 (Chrome/Edge/Opera/Electron; Firefox + Safari lack SysEx WebMIDI).
// Requirements: secure context (https or http://localhost), call from a user gesture the first time
// (permission prompt "control and reprogram MIDI devices"), Valeton Suite closed (Windows ports are exclusive).

export class Gp5ConnectError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code; // no-webmidi | insecure | permission | sysex-denied | chrome-152 | not-found
    Object.assign(this, details);
  }
}

/** GP-5 port names look like "GP-5", "GP-5 MIDI", "GP-5 MIDI 1" or "GP-5 MIDI (mock)". Never match "GP-50". */
export const GP5_PORT_RE = /GP-5(?!\d)/i;

/** Chrome/Chromium 152 breaks WebMIDI SysEx (F0/F7 duplicated, replies dropped); fixed in 153. */
export function brokenSysexBrowser(nav = globalThis.navigator) {
  const brands = nav?.userAgentData?.brands ?? [];
  let major = null;
  for (const b of brands) if (/Chrom/i.test(b.brand)) major = Number(b.version);
  if (major === null) {
    const m = /Chrom(?:e|ium)\/(\d+)/.exec(nav?.userAgent ?? "");
    if (m) major = Number(m[1]);
  }
  return major === 152 ? `Chromium ${major} cannot exchange SysEx with the pedal; update to 153+` : null;
}

export async function requestAccess() {
  if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function")
    throw new Gp5ConnectError("no-webmidi", "This browser has no WebMIDI. Use desktop Chrome or Edge (or Electron).");
  if (typeof isSecureContext !== "undefined" && !isSecureContext)
    throw new Gp5ConnectError("insecure", "WebMIDI needs https:// or http://localhost.");
  const broken = brokenSysexBrowser();
  if (broken) throw new Gp5ConnectError("chrome-152", broken);
  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: true });
  } catch (e) {
    throw new Gp5ConnectError("permission", `MIDI permission denied (${e.name}). Allow "MIDI devices" in site settings.`);
  }
  if (access.sysexEnabled === false) throw new Gp5ConnectError("sysex-denied", "SysEx access was not granted.");
  return access;
}

export function listPorts(access) {
  const map = (m) => [...m.values()].map((p) => ({ id: p.id, name: p.name, manufacturer: p.manufacturer, state: p.state }));
  return { inputs: map(access.inputs), outputs: map(access.outputs) };
}

function pick(ports, match) {
  const all = [...ports.values()].filter((p) => p.state !== "disconnected");
  if (typeof match === "string") return all.find((p) => p.name === match) ?? all.find((p) => p.name?.includes(match));
  return all.find((p) => match.test(p.name ?? ""));
}

/**
 * Open the GP-5 MIDI ports. Returns a transport for Gp5Session plus `ports` and an `ondisconnect` hook.
 * @param opts { access?: MIDIAccess, port?: string | RegExp, onDisconnect?: () => void }
 */
export async function connectWebMidi({ access, port = GP5_PORT_RE, onDisconnect } = {}) {
  access ??= await requestAccess();
  const input = pick(access.inputs, port);
  const output = pick(access.outputs, port);
  if (!input || !output) {
    const seen = listPorts(access).outputs.map((p) => p.name);
    throw new Gp5ConnectError(
      "not-found",
      `No GP-5 MIDI port found (visible: ${seen.join(", ") || "none"}). Connect the pedal by USB, power it on, close Valeton Suite.` +
        " Windows 11: if the pedal shows as 'USB MIDI 2.0 Device', see the driver note in skill gp5-usb-connection.",
      { visiblePorts: seen }
    );
  }
  await Promise.all([input.open(), output.open()]);
  let listener = null;
  const onMidi = (e) => listener?.(e.data);
  input.addEventListener("midimessage", onMidi);
  const onState = (e) => {
    if ((e.port.id === input.id || e.port.id === output.id) && e.port.state === "disconnected") onDisconnect?.();
  };
  access.addEventListener("statechange", onState);
  return {
    name: output.name,
    ports: { input, output, access },
    send: (bytes) => output.send(bytes),
    onMessage: (cb) => {
      listener = cb;
    },
    close: async () => {
      input.removeEventListener("midimessage", onMidi);
      access.removeEventListener("statechange", onState);
      await Promise.allSettled([input.close(), output.close()]);
    },
  };
}
