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

See what every PC is actually running:

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
