!include "LogicLib.nsh"
!include "installer-path-policy.nsh"

Function zhixing.validateInstallRoot
  Push $R0
  Push $R1

  StrLen $R0 "$INSTDIR"
  ${If} $R0 <= ${ZHIXING_MAX_INSTALL_ROOT_LENGTH}
    StrCpy $R0 "ok"
  ${Else}
    StrCpy $R0 "too-long"
  ${EndIf}

  Pop $R1
  Exch $R0
FunctionEnd

!macro customInit
  Call zhixing.validateInstallRoot
  Pop $0
  StrCmp $0 "ok" zhixing_valid_install_root
  IfSilent zhixing_silent_install
  MessageBox MB_OK|MB_ICONSTOP "所选安装目录超过此版本 Windows 文件路径上限（${ZHIXING_MAX_INSTALL_ROOT_LENGTH} 字符）。请改选较短的本机目录后重新安装。现有版本和用户数据保持不变。"
  zhixing_silent_install:
    SetErrorLevel 87
    Quit

  zhixing_valid_install_root:
!macroend

Function .onVerifyInstDir
  Call zhixing.validateInstallRoot
  Pop $0
  StrCmp $0 "ok" zhixing_valid_install_directory
  MessageBox MB_OK|MB_ICONEXCLAMATION "所选安装目录过长。请改选较短的本机目录。"
  Abort
  zhixing_valid_install_directory:
FunctionEnd
