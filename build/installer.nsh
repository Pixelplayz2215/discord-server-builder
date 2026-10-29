; Custom pages for the Discord Server Builder installer (electron-builder includes this file
; automatically). Shows who made it and where the only official download is.

!define OFFICIAL_URL "https://github.com/Pixelplayz2215/discord-server-builder/releases/latest"

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Discord Server Builder$\r$\nby Pixelplayz2215"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  ; The page text is drawn in welcomeShow so the GitHub address can be a clickable link.
  !define MUI_WELCOMEPAGE_TEXT " "
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW welcomeShow
  !insertmacro MUI_PAGE_WELCOME

  ; Positions follow MUI2's welcome layout: text column at 120u, 195u wide, starting at 55u
  ; below a three-line title, on a 193u-tall page.
  Function welcomeShow
    ; MUI's own (empty) text label covers this area; hide it so the link can be seen and clicked.
    ShowWindow $mui.WelcomePage.Text ${SW_HIDE}

    ${NSD_CreateLabel} 120u 55u 195u 20u "This will install Discord Server Builder, made by Pixelplayz2215."
    Pop $0
    SetCtlColors $0 "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"

    ${NSD_CreateLabel} 120u 80u 195u 10u "IMPORTANT: the only official download is on GitHub:"
    Pop $0
    SetCtlColors $0 "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"

    ${NSD_CreateLink} 120u 91u 195u 10u "github.com/Pixelplayz2215/discord-server-builder"
    Pop $0
    SetCtlColors $0 "0066CC" "${MUI_BGCOLOR}"
    ${NSD_OnClick} $0 openOfficialPage

    ${NSD_CreateLabel} 120u 106u 195u 80u "If you got this installer anywhere else, cancel now. Copies from other places could be changed to steal your bot token.$\r$\n$\r$\nNever share your bot token with anyone, including people claiming to be Pixelplayz2215.$\r$\n$\r$\nClick Next to continue."
    Pop $0
    SetCtlColors $0 "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"
  FunctionEnd

  Function openOfficialPage
    Pop $0 ; the clicked link
    ${StdUtils.ExecShellAsUser} $0 "${OFFICIAL_URL}" "open" ""
  FunctionEnd
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_TITLE "Discord Server Builder is installed"
  !define MUI_FINISHPAGE_TEXT "Made by Pixelplayz2215.$\r$\n$\r$\nThe app tells you when a new version is out and updates itself. If you ever need to download it again, only use the official GitHub page below.$\r$\n$\r$\nYour bots, tokens and settings are stored only on this PC."
  !define MUI_FINISHPAGE_LINK "Official download page (GitHub)"
  !define MUI_FINISHPAGE_LINK_LOCATION "${OFFICIAL_URL}"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Uninstall Discord Server Builder"
  !define MUI_WELCOMEPAGE_TEXT "This removes Discord Server Builder by Pixelplayz2215 from this PC.$\r$\n$\r$\nYour bots, tokens and settings are kept in %APPDATA%\Discord Server Builder, so they'll still be there if you reinstall. Delete that folder yourself if you want them gone.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
