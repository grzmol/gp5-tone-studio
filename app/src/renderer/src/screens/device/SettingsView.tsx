import { useEffect, useState, type ReactNode } from "react";
import { FolderOpen, LogOut, Package } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { notifyError } from "@/app/notify";
import { host, isElectron } from "@/host";
import { useNav } from "@/state/nav";
import { loadAccount, setAppKey, signOut, useTones } from "@/screens/tones/store";
import { useAppSettings } from "./settings-store";

/** Settings (`?screen=device&param=settings`): how Tone Studio behaves on this computer. */
export function SettingsView() {
  const { settings, loaded, load, patch } = useAppSettings();
  const go = useNav((s) => s.go);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void load().catch((e) => notifyError("Couldn't read the settings", e));
    void host.app.version().then(setVersion, () => {});
    void loadAccount();
  }, [load]);

  const save = (p: Parameters<typeof patch>[0]) => void patch(p).catch((e) => notifyError("Couldn't save the setting", e));

  return (
    <div className="h-full overflow-auto">
      <div className="flex max-w-[920px] flex-col gap-6 px-7 pt-[22px] pb-8">
        <div>
          <h1 className="text-[44px] leading-none font-bold tracking-[-0.02em] text-balance">Settings</h1>
          <p className="mt-2 text-pretty text-silkscreen-3">
            How Tone Studio behaves on this computer. Settings stored on the pedal itself are on the{" "}
            <button type="button" className="text-silkscreen-2 underline underline-offset-2 hover:text-silkscreen" onClick={() => go("device")}>
              Device
            </button>{" "}
            page.
          </p>
        </div>

        <Section title="Editing">
          <Row label="Show knob values" description="Print each knob's value under its label on the gear, not only while you turn it.">
            <Switch checked={settings.showValues} disabled={!loaded} onCheckedChange={(v) => save({ showValues: v })} aria-label="Show knob values" />
          </Row>
          <Row label="Back up before every write" description="Before the app saves, renames or writes a slot, it copies what is in that slot now into Replaced presets.">
            <Switch checked={settings.backupBeforeWrite} disabled={!loaded} onCheckedChange={(v) => save({ backupBeforeWrite: v })} aria-label="Back up before every write" />
          </Row>
        </Section>

        <Section title="Pedal connection">
          <PortPatternRow value={settings.portPattern} disabled={!loaded} onSave={(portPattern) => save({ portPattern })} />
          {/* Only Windows and macOS builds read anything from the Suite install (the SnapTone test signal). */}
          {isElectron && host.platform !== "linux" && (
            <SuitePathRow value={settings.valetonSuitePath} disabled={!loaded} onSave={(valetonSuitePath) => save({ valetonSuitePath })} />
          )}
        </Section>

        <Section title="TONE3000 account">
          <AppKeyRow />
          <AccountRow />
        </Section>

        <Section title="About">
          <Row
            label={isElectron ? `Tone Studio ${version ?? ""}`.trim() : "Tone Studio in the browser"}
            description={isElectron ? "Desktop app for the Valeton GP-5." : "Backups stay in this browser. Valeton Suite and folders on disk need the desktop app."}
          />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 text-sm font-semibold text-silkscreen-2">{title}</h2>
      <div className="rounded-lg bg-card shadow-[0_0_0_1px_var(--seam)]">{children}</div>
    </section>
  );
}

function Row({ label, description, children }: { label: ReactNode; description: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] items-center gap-6 border-b px-5 py-3.5 last:border-b-0">
      <div>
        <b className="block font-semibold">{label}</b>
        <span className="block text-sm text-pretty text-silkscreen-3">{description}</span>
      </div>
      {children && <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>}
    </div>
  );
}

function PortPatternRow({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const dirty = draft.trim() !== (value ?? "");
  return (
    <Row
      label="MIDI port name"
      description={`Leave empty to find the pedal automatically (any port named like "GP-5", never "GP-50"). Enter part of a port name to use that port instead, for example a virtual GP-5.`}
    >
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft.trim() || null);
        }}
      >
        <Input
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Automatic"
          aria-label="MIDI port name"
          spellCheck={false}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="outline" disabled={disabled || !dirty}>
          Save
        </Button>
        {value && (
          <Button type="button" variant="ghost" onClick={() => onSave(null)}>
            Automatic
          </Button>
        )}
      </form>
    </Row>
  );
}

function SuitePathRow({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (v: string | null) => void }) {
  const pick = async () => {
    try {
      const path = await host.device.pickSuitePath();
      if (path) onSave(path);
    } catch (e) {
      notifyError("Couldn't choose Valeton Suite", e);
    }
  };
  return (
    <Row
      label="Valeton Suite"
      description="Tone Studio takes Valeton's SnapTone test signal from this install. Firmware updates for the pedal also run in Suite."
    >
      <div className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-pill bg-well px-3.5 shadow-[inset_0_0_0_1px_var(--seam-strong)]">
        <Package className="size-3.5 shrink-0 text-silkscreen-3" aria-hidden />
        <span className={value ? "truncate text-silkscreen" : "truncate text-silkscreen-3"} title={value ?? undefined}>
          {value ?? "Not chosen"}
        </span>
      </div>
      <Button variant="outline" disabled={disabled} onClick={() => void pick()}>
        {value ? "Change" : "Choose"}
      </Button>
      {value && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open Valeton Suite"
          title="Open Valeton Suite"
          onClick={() => void host.app.openPath(value).catch((e) => notifyError("Couldn't open Valeton Suite", e))}
        >
          <FolderOpen aria-hidden />
        </Button>
      )}
    </Row>
  );
}

function AppKeyRow() {
  const account = useTones((s) => s.account);
  const saved = account?.appKey ?? null;
  const [draft, setDraft] = useState(saved ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(saved ?? ""), [saved]);
  const dirty = draft.trim() !== (saved ?? "");
  const disabled = !account || busy;

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      await setAppKey(value);
    } catch (e) {
      notifyError("Couldn't save the TONE3000 app key", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row
      label="App key"
      description={
        isElectron
          ? "The publishable key (client_id) of your TONE3000 app. Leave empty to use the key this build came with. A different key signs you out."
          : "Signing in to TONE3000 needs the desktop app."
      }
    >
      {isElectron ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft.trim() || null);
          }}
        >
          <Input
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={account?.configured && !saved ? "Built into this build" : "Not set"}
            aria-label="TONE3000 app key"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="outline" disabled={disabled || !dirty}>
            Save
          </Button>
          {saved && (
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => void save(null)}>
              Clear
            </Button>
          )}
        </form>
      ) : (
        <span className="text-sm text-silkscreen-3">Needs the desktop app</span>
      )}
    </Row>
  );
}

function AccountRow() {
  const go = useNav((s) => s.go);
  const account = useTones((s) => s.account);
  const [confirm, setConfirm] = useState(false);

  const disconnect = async () => {
    try {
      await signOut();
      setConfirm(false);
    } catch (e) {
      notifyError("Couldn't sign out of TONE3000", e);
    }
  };

  const user = account?.status === "signed-in" ? account.user : null;
  return (
    <Row label="TONE3000" description="Browse and download NAM captures and IRs. Signing in happens on TONE3000's own page.">
      {!account ? null : user ? (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Avatar className="size-8">
              {user.avatar_url && <AvatarImage src={user.avatar_url} alt="" />}
              <AvatarFallback>{(user.display_name ?? user.username).slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <b className="block truncate font-semibold">{user.display_name ?? user.username}</b>
              <span className="block text-sm text-silkscreen-3">Signed in. Tone downloads go to tones/ in the data folder.</span>
            </div>
          </div>
          <Button variant="outline" onClick={() => setConfirm(true)}>
            <LogOut aria-hidden />
            Disconnect
          </Button>
          <Dialog open={confirm} onOpenChange={setConfirm}>
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader>
                <DialogTitle>Sign out of TONE3000?</DialogTitle>
                <DialogDescription>Downloaded tones stay in your data folder.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button onClick={() => void disconnect()}>Sign out</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-silkscreen-3">{account.status === "expired" ? "Signed out: the session expired" : "Not signed in"}</span>
          <Button variant="outline" onClick={() => go("tones")} disabled={!account.configured}>
            Sign in on Tones
          </Button>
        </>
      )}
    </Row>
  );
}
