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

  ; Which distribution. The default is where a WSL user's work lives, so that is
  ; what we take — but the details pane names it, because someone with three of
  ; them must not find factorai installed somewhere they did not expect.
  ; `/DISTRO=Debian` overrides.
  ;
  ; **We ask the distribution its own name rather than parsing `wsl --list`.**
  ; `wsl.exe` writes its own output as UTF-16LE, so every character of a parsed
  ; list arrives with an interleaved NUL and nothing downstream matches. A
  ; process inside the distribution answers in plain UTF-8.
  ;
  ; `printenv` and not `sh -c`: one argument, no shell, and therefore no layer of
  ; quoting to get wrong between NSIS, `wsl.exe` and a shell. The round trip also
  ; doubles as proof that the default distribution actually boots.
  ${GetOptions} $CMDLINE "/DISTRO=" $Distro
  ${If} $Distro == ""
    nsExec::ExecToStack 'wsl.exe -- printenv WSL_DISTRO_NAME'
    Pop $0
    Pop $Distro
    ${TrimNewLines} $Distro $Distro
    ${If} $0 != 0
    ${OrIf} $Distro == ""
      ${EnableX64FSRedirection}
      MessageBox MB_ICONSTOP "WSL is installed but has no usable distribution.\
        $\r$\n$\r$\nOpen PowerShell and run:$\r$\n$\r$\n    wsl --install -d Ubuntu-24.04\
        $\r$\n$\r$\nThen run this installer again."
      Abort
    ${EndIf}
  ${EndIf}

  ${EnableX64FSRedirection}
FunctionEnd

Section "factorai" SecMain
  SetOutPath "$INSTDIR"
  File "setup-in-distro.sh"

  DetailPrint "Installing into the WSL distribution: $Distro"

  ; See `.onInit`: 32-bit installer, redirected System32, no `wsl.exe` without this.
  ${DisableX64FSRedirection}

  ; `--cd` takes a Windows path and puts the shell in the translated one, which
  ; is what keeps this line free of `wslpath` and of the quoting knot that comes
  ; with nesting a command substitution inside two layers of escaping. The script
  ; is then simply in the working directory.
  ;
  ; `bash <file>` rather than executing it: a file copied from Windows carries no
  ; executable bit, and chmod-ing it would be a second thing to get right.
  nsExec::ExecToLog 'wsl.exe -d "$Distro" --cd "$INSTDIR" -- bash ./setup-in-distro.sh "${APPIMAGE_URL}" "${VERSION}"'
  Pop $0
  ${EnableX64FSRedirection}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "The install inside $Distro did not finish.$\r$\n$\r$\n\
      The details above say why. Nothing was changed on Windows."
    Abort
  ${EndIf}

  ; Add/Remove Programs. Windows users look there first, and an app with no entry
  ; reads as something that should not be trusted. HKCU rather than HKLM, to
  ; match the per-user install.
  WriteUninstaller "$INSTDIR\uninstall.exe"
  !define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\factorai"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "factorai (WSL: $Distro)"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "factorai contributors"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  ; Which distribution we installed into, so the uninstaller cleans the right one
  ; rather than whichever is default by then.
  WriteRegStr HKCU "${UNINST_KEY}" "Distro" "$Distro"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

; ── Uninstall ────────────────────────────────────────────────────────────────
; Removes what we placed. The optional second step removes factorai's own
; database and settings — and nothing here offers to remove `~/.claude`, which
; holds Claude's transcripts and the user's login. We only ever read those
; (ADR-0004); deleting them is not ours to offer.
Function un.onInit
  ReadRegStr $UnDistro HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\factorai" "Distro"
  StrCpy $WipeData "no"
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Also delete factorai's database and settings?$\r$\n$\r$\n\
     ~/.local/share/dev.factorai/ inside $UnDistro$\r$\n$\r$\n\
     Your Claude transcripts and login (~/.claude) are never touched, and \
     neither are your project folders." IDNO keep
  StrCpy $WipeData "yes"
  keep:
FunctionEnd

Section "Uninstall"
  ${DisableX64FSRedirection}
  ; An empty distro name would make `wsl -d ""` ambiguous, so fall back to the
  ; default rather than guessing — a registry key old enough to lack it predates
  ; nothing we ship, but the uninstaller must not become the failing half.
  ${If} $UnDistro == ""
    nsExec::ExecToLog 'wsl.exe -- bash -lc "rm -f ~/.local/bin/factorai.AppImage ~/.local/share/applications/factorai.desktop ~/.local/share/icons/hicolor/128x128/apps/factorai.png"'
  ${Else}
    nsExec::ExecToLog 'wsl.exe -d "$UnDistro" -- bash -lc "rm -f ~/.local/bin/factorai.AppImage ~/.local/share/applications/factorai.desktop ~/.local/share/icons/hicolor/128x128/apps/factorai.png"'
    ${If} $WipeData == "yes"
      nsExec::ExecToLog 'wsl.exe -d "$UnDistro" -- bash -lc "rm -rf ~/.local/share/dev.factorai"'
    ${EndIf}
  ${EndIf}
  ${EnableX64FSRedirection}
  Delete "$INSTDIR\setup-in-distro.sh"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\factorai"
SectionEnd
