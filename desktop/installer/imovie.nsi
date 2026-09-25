; iMovie installer: per-user (no admin prompt), desktop + Start menu shortcuts, uninstaller in Apps.
; Built on any OS with makensis:  makensis -DSRCDIR=<win-unpacked> -DOUTFILE=<setup.exe> -DICON=<icon.ico> -DVERSION=x.y.z imovie.nsi
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APPNAME "iMovie"
!define APPEXE "iMovie.exe"
!define UNINSTEXE "Uninstall iMovie.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\iMovieDesktop"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\iMovie"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText " "
Icon "${ICON}"
UninstallIcon "${ICON}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" " "

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open iMovie"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; an open copy of iMovie would keep its files locked
  nsExec::Exec 'taskkill /F /IM "${APPEXE}"'
  Sleep 400
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources"
  File /r "${SRCDIR}/*.*"
  WriteUninstaller "$INSTDIR\${UNINSTEXE}"
  CreateShortcut "$DESKTOP\iMovie.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0
  CreateShortcut "$SMPROGRAMS\iMovie.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "iMovie for the web"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\${UNINSTEXE}"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" $0
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${APPEXE}"'
  Sleep 400
  Delete "$DESKTOP\iMovie.lnk"
  Delete "$SMPROGRAMS\iMovie.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  ; (projects and imported media stay in %APPDATA%\iMovie)
SectionEnd
