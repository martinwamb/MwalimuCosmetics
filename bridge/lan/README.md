# Pushing FumasV5 updates over the shop LAN

Updating every PC by hand is the thing this replaces. After a one-time
setup, publishing a new FumasV5 build is a single command on the laptop,
and every till installs it by itself.

Only two PCs have internet, but **that does not matter**: the updates
travel over the ethernet cable, not the internet. The laptop is the only
machine that ever needs to be online, because it is where builds are made
anyway.

## How it works

```
laptop  --(ethernet)-->  hub share on 10.10.10.4  <--(poll every 10 min)--  every till
```

1. `publish-update.ps1` on the laptop copies one build into a read-only
   share on the hub, and stamps it with a version.
2. Each till runs a scheduled task every 10 minutes. It compares the
   published version with its own and, if they differ, copies the new
   build in as `FumasV5_new.exe`.
3. The next time the POS is opened, `launch-pos.bat` swaps that staged
   file into place.

Step 3 is why a running till is never disturbed: Windows will not let you
overwrite a running `.exe`, so the new build waits until the POS is next
started, when the file is definitely free. Staff notice nothing.

The check script itself lives **in the share**, not on the tills. Each
till only holds a five-line bootstrap that calls it. That is deliberate —
it means the update logic can be corrected from the laptop later without
anyone walking to a machine again.

## Setup (once)

**1. On the hub — server-pc, 10.10.10.4.** It already runs MySQL, so it
is on whenever the shop is trading.

> Right-click `setup-hub.bat` → Run as administrator

**2. On the laptop.** Put the current build in the share:

```powershell
.\publish-update.ps1
```

**3. On every other PC.** This is the last visit any of them needs.

> Right-click `setup-pc.bat` → Run as administrator

**4. Back on the laptop**, once, in an **Administrator** PowerShell:

```powershell
.\run-on-all.ps1 -TrustHosts
```

## Everyday use

Publish a new build to the whole shop:

```powershell
.\publish-update.ps1
.\publish-update.ps1 -Source "C:\path\to\FumasV5-updated.exe"
```

See what every PC is actually running — **the reliable way** on this shop's
network, where the tills' "Guest only" security model blocks the laptop from
reaching into them:

```powershell
.\fleet-status.ps1
```

Each till writes its name, installed build and a timestamp to a small
`checkins` share on the hub every 10 minutes (an outbound write the tills
*can* do), and this reads them all into one table. One-time enable: run
`setup-checkin.bat` on the hub once. Tills report in on their next cycle.

`run-on-all.ps1 -Status` reads the same facts by reaching *into* each PC over
WinRM — which only works once full remote control is enabled (see below), so
prefer `fleet-status.ps1` unless you have done that:

```powershell
.\run-on-all.ps1 -Status
```

Don't want to wait ten minutes:

```powershell
.\run-on-all.ps1 -Command "schtasks /run /tn MwalimuLanUpdate"
```

Run anything, anywhere:

```powershell
.\run-on-all.ps1 -Command "ipconfig /all"
.\run-on-all.ps1 -Script .\fix-something.ps1
.\run-on-all.ps1 -Command "..." -Targets 10.10.10.12
```

## Remote control (optional) and the Guest-only wall

The tills are set to Windows' "Guest only" network security model
(`HKLM\SYSTEM\CurrentControlSet\Control\Lsa\ForceGuest = 1`), which maps any
inbound network login with a local account to Guest — so the laptop cannot
reach *into* them over `C$` or WinRM, and `run-on-all.ps1` / `-Status` will
fail. This does **not** affect updates: each till reaches *out* to the hub as
SYSTEM, which is allowed, and `fleet-status.ps1` reads status the same
outbound way.

To turn on true remote control (so `run-on-all.ps1` works), each till needs,
run locally once — it cannot be bootstrapped remotely, since the block is the
very thing in the way:

```
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Lsa" /v ForceGuest /t REG_DWORD /d 0 /f
```

`setup-pc.bat` already sets `LocalAccountTokenFilterPolicy` and enables
PSRemoting; this one registry value is the remaining piece.

## The machines

Eleven Windows PCs, found by ARP sweep on 2026-08-10:

| IP | Name | | IP | Name |
|----|------|-|----|------|
| .4 | SERVER-PC (hub) | | .56 | unnamed |
| .6 | unnamed | | .71 | MWALIMU-PC |
| .12 | unnamed | | .156 | CASHER1-PC |
| .16 | unnamed | | .157 | unnamed |
| .44 | unnamed | | .158 | MWALIMU-OFFICE |
| | | | .180 | SERVEROLD-PC |

Plus the laptop on .50. Not PCs: `.86` is a network printer, `.63` answers
ARP but exposes no ports.

**Do not use ping or `net view` to find these machines.** Most block ping,
and the unnamed ones have NetBIOS disabled, so both methods report only
about a third of what is really on the wire. Re-scan with:

```powershell
1..254 | ForEach-Object { $c = New-Object Net.Sockets.TcpClient
  $null = $c.BeginConnect("10.10.10.$_", 445, $null, $null) }
Start-Sleep 3; arp -a
```

## Notes

- A PC that was switched off during a publish catches up on its own when
  it next boots. Nothing needs re-running for it.
- Publishing the same build twice does nothing — the version is a hash of
  the exe, not a timestamp.
- Every copy is size-checked before it is marked as installed, so a
  half-copied exe is discarded and retried rather than leaving a till
  broken but looking up to date.
- Per-PC log: `C:\MwalimuSync\lan-update.log`
- Two accounts are created. `mwalimuupd` is read-only and exists only so
  the tills can pull from the hub share — a compromised till therefore
  cannot poison the build everyone installs. `mwalimuadmin` is the admin
  account: on the hub it has write access so the laptop can publish, and
  on each till it allows remote administration. So the laptop always uses
  `mwalimuadmin`, the tills always use `mwalimuupd`. Their passwords are in
  the scripts, worth changing if the shop LAN ever carries guest traffic;
  both would need changing in `setup-hub.bat`, `setup-pc.bat`, and the two
  `.ps1` defaults.
- This is independent of the Hetzner sync agent in `bridge/`. That still
  handles the two internet PCs and its own self-update; this handles
  FumasV5 on everything, online or not.
