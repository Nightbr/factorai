; factorai's Windows installer (ADR-0044).
;
; This does NOT install a Windows application. factorai on Windows is the Linux
; build running inside a WSL 2 distribution under WSLg, so what this `.exe` does
; is check the machine, name the distribution it is about to use, and hand
; `setup-in-distro.sh` to it. Roughly a megabyte, run once: the app updates
; itself afterwards through the AppImage updater (F14, ADR-0010).
;
; It deliberately **provisions nothing**. Installing WSL itself needs elevation
; and a reboot, and owning that flow means owning its failures — virtualization
; disabled in firmware, Hyper-V off, an enterprise policy. When something is
; missing this prints the exact command and stops.
;
; Built with `makensis` on the Linux release runner, not on a Windows one. See
; `.github/workflows/release.yml`.
;
; Required defines:
;   VERSION       the release version, without the leading v
;   APPIMAGE_URL  where the matching x86_64 AppImage lives

!ifndef VERSION
  !error "VERSION must be defined: makensis -DVERSION=0.1.0 -DAPPIMAGE_URL=... factorai.nsi"
!endif
!ifndef APPIMAGE_URL
  !error "APPIMAGE_URL must be defined"
!endif

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"
!include "TextFunc.nsh"
!include "x64.nsh"

Name "factorai ${VERSION}"
OutFile "factorai-setup-${VERSION}.exe"
Unicode true
; Per-user. Nothing here writes outside the user's profile or their own WSL
; distribution, so asking for elevation would be asking for a privilege we have
; no use for.
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\factorai"
ShowInstDetails show
ShowUnInstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "factorai"
VIAddVersionKey "FileDescription" "factorai installer (WSL 2)"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "factorai contributors"

Var Distro
Var DistroFlag
Var UnDistro
Var WipeData

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_LICENSE "..\..\..\LICENSE"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ── Preflight ────────────────────────────────────────────────────────────────
; Three checks, in the order that produces the most useful failure: a machine
; that cannot run WSLg at all should hear that before it hears about distros.
Function .onInit
  ; The floor is WSLg's, not WSL 2's. WSL 2 goes back further, but WSLg starts at
  ; Windows 10 21H2 — build 19044 — and Windows 11 is 22000 and up, so one build
  ; comparison covers both without asking which Windows this is.
  ${IfNot} ${AtLeastBuild} 19044
    MessageBox MB_ICONSTOP "factorai needs Windows 10 version 21H2 (build 19044) \
      or newer — that is where WSLg starts.$\r$\n$\r$\nUpdate Windows, then run \
      this installer again."
    Abort
  ${EndIf}

  ; **Every `wsl.exe` call in this file runs with file-system redirection off.**
  ; NSIS builds a 32-bit installer, and a 32-bit process on 64-bit Windows has
  ; `C:\Windows\System32` silently redirected to `SysWOW64` — where `wsl.exe`
  ; does not exist. Without this the installer reports "WSL is not available" on
  ; a machine that is running WSL perfectly well. WSL 2 is x64-only, so there is
  ; no 32-bit Windows case to keep working.
  ${DisableX64FSRedirection}

  ; `wsl --status` is the cheapest question that fails on both "WSL is not
  ; installed" and "WSL is installed but not working".
  nsExec::ExecToStack 'wsl.exe --status'
  Pop $0
  Pop $1
  ${If} $0 != 0
    ${EnableX64FSRedirection}
    MessageBox MB_ICONSTOP "WSL 2 is not available on this machine.$\r$\n$\r$\n\
      Open PowerShell and run:$\r$\n$\r$\n    wsl --install$\r$\n$\r$\n\
      Restart when it asks, then run this installer again."
    Abort
  ${EndIf}

  ; Which distribution.
  ;
  ; **A name read back out of `wsl.exe` is never passed to `wsl.exe`**, and v0.40.0
  ; shipped doing exactly that. The probe below returned `Ubuntu`, the details
  ; pane printed `Ubuntu`, and `wsl.exe -d "Ubuntu"` answered
  ; `WSL_E_DISTRO_NOT_FOUND` on a machine where `wsl -d Ubuntu` works by hand.
  ; The string had something invisible on it: `nsExec::ExecToStack` captures
  ; stdout **and stderr together**, and `wsl.exe` writes its own messages in
  ; UTF-16LE, so one byte of a notice mixed into otherwise-ASCII output prints
  ; identically and matches nothing.
  ;
  ; So the name is **display only** now, and the flag is built from the command
  ; line instead — which is clean by construction:
  ;
  ;   no `/DISTRO=`  ->  no `-d` at all. `wsl.exe` uses the default distribution,
  ;                      which is the one the probe was pointing at anyway, so the
  ;                      flag never did anything except add a way to fail.
  ;   `/DISTRO=Deb`  ->  `-d "Deb"`, a string the user typed and we never parsed.
  ;
  ; The probe stays, for two things that do not need a trustworthy string: naming
  ; the target in the details pane, and proving a default distribution actually
  ; boots. **Its exit code is the liveness signal, not its output** — for the same
  ; reason the output is not trusted anywhere else.
  ${GetOptions} $CMDLINE "/DISTRO=" $Distro
  ${If} $Distro == ""
    StrCpy $DistroFlag ""
    nsExec::ExecToStack 'wsl.exe -- printenv WSL_DISTRO_NAME'
    Pop $0
    Pop $Distro
    ${TrimNewLines} $Distro $Distro
    ${If} $0 != 0
      ${EnableX64FSRedirection}
      MessageBox MB_ICONSTOP "WSL is installed but has no usable distribution.\
        $\r$\n$\r$\nOpen PowerShell and run:$\r$\n$\r$\n    wsl --install -d Ubuntu-24.04\
        $\r$\n$\r$\nThen run this installer again."
      Abort
    ${EndIf}
    ${If} $Distro == ""
      StrCpy $Distro "your default distribution"
    ${EndIf}
  ${Else}
    StrCpy $DistroFlag '-d "$Distro"'
  ${EndIf}

  ${EnableX64FSRedirection}
FunctionEnd

Section "factorai" SecMain
  SetOutPath "$INSTDIR"
  File "setup-in-distro.sh"

  ; Brackets, so a stray character in a name read back from `wsl.exe` is visible
  ; here instead of invisible. That is all this string is for now — see `.onInit`.
  DetailPrint "Installing into the WSL distribution: [$Distro]"

  ; See `.onInit`: 32-bit installer, redirected System32, no `wsl.exe` without this.
  ${DisableX64FSRedirection}

  ; `--cd` takes a Windows path and puts the shell in the translated one, which
  ; is what keeps this line free of `wslpath` and of the quoting knot that comes
  ; with nesting a command substitution inside two layers of escaping. The script
  ; is then simply in the working directory.
  ;
  ; `bash <file>` rather than executing it: a file copied from Windows carries no
  ; executable bit, and chmod-ing it would be a second thing to get right.
  ;
  ; **`ExecWait` and not `nsExec`, because the script needs a terminal.** It runs
  ; `sudo apt-get` for the two packages an AppImage under WSLg needs, and `nsExec`
  ; hands its child no stdin and no console — so sudo's password prompt has
  ; nothing to read from and the install hangs or fails on a default Ubuntu,
  ; where that password is not optional. `ExecWait` launching a console
  ; application from a GUI installer gets a console window of its own: the user
  ; sees apt and the download progress, and can answer the prompt. The cost is
  ; that the details pane below no longer carries the script's output, which is
  ; why the script pauses on the way out rather than letting the window vanish.
  ExecWait 'wsl.exe $DistroFlag --cd "$INSTDIR" -- bash ./setup-in-distro.sh "${APPIMAGE_URL}" "${VERSION}"' $0
  ${EnableX64FSRedirection}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "The install inside $Distro did not finish.$\r$\n$\r$\n\
      The console window said why. Nothing was changed on Windows."
    Abort
  ${EndIf}

  ; Add/Remove Programs. Windows users look there first, and an app with no entry
  ; reads as something that should not be trusted. HKCU rather than HKLM, to
  ; match the per-user install.
  WriteUninstaller "$INSTDIR\uninstall.exe"
  !define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\factorai"
  ; Plain, because `$Distro` may be the placeholder rather than a name — see
  ; `.onInit`. Which distribution it went into is the details pane's job, not
  ; Add/Remove Programs'.
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "factorai (WSL 2)"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "factorai contributors"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  ; **The flag, not the name.** Empty when the install went to the default
  ; distribution, which is what the uninstaller then targets too. Recording a
  ; name we read back out of `wsl.exe` would hand the uninstaller the same
  ; unusable string that broke v0.40.0's install.
  WriteRegStr HKCU "${UNINST_KEY}" "DistroFlag" "$DistroFlag"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

; ── Uninstall ────────────────────────────────────────────────────────────────
; Removes what we placed. The optional second step removes factorai's own
; database and settings — and nothing here offers to remove `~/.claude`, which
; holds Claude's transcripts and the user's login. We only ever read those
; (ADR-0004); deleting them is not ours to offer.
Function un.onInit
  ReadRegStr $UnDistro HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\factorai" "DistroFlag"
  StrCpy $WipeData "no"
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Also delete factorai's database and settings?$\r$\n$\r$\n\
     ~/.local/share/dev.factorai/ inside the WSL distribution$\r$\n$\r$\n\
     Your Claude transcripts and login (~/.claude) are never touched, and \
     neither are your project folders." IDNO keep
  StrCpy $WipeData "yes"
  keep:
FunctionEnd

Section "Uninstall"
  ${DisableX64FSRedirection}
  ; `$UnDistro` is the whole `-d "name"` flag, or empty for the default
  ; distribution — so there is one command here rather than a branch, and no
  ; place for `wsl -d ""` to be built out of a missing value.
  nsExec::ExecToLog 'wsl.exe $UnDistro -- bash -lc "rm -f ~/.local/bin/factorai.AppImage ~/.local/share/applications/factorai.desktop ~/.local/share/icons/hicolor/128x128/apps/factorai.png"'
  ${If} $WipeData == "yes"
    nsExec::ExecToLog 'wsl.exe $UnDistro -- bash -lc "rm -rf ~/.local/share/dev.factorai"'
  ${EndIf}
  ${EnableX64FSRedirection}
  Delete "$INSTDIR\setup-in-distro.sh"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\factorai"
SectionEnd
