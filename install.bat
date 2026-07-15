@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: Second Brain Builder — Obsidian Plugin Installer (Windows)
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: ============================================================
:: Build
:: ============================================================

echo.
echo [1/2] Building plugin...
echo.

pushd "%SCRIPT_DIR%"

if not exist "node_modules" (
    call npm install
    if errorlevel 1 (
        echo ERROR: npm install failed.
        popd
        pause
        exit /b 1
    )
)

call npm run build
if errorlevel 1 (
    echo ERROR: Build failed.
    popd
    pause
    exit /b 1
)

popd

echo.
echo Build complete.
echo.

:: ============================================================
:: Auto-detect vaults from Obsidian config
:: ============================================================

echo [2/2] Installing into vaults...
echo.

set "COUNT=0"
set "OBS_CONFIG=%APPDATA%\obsidian\obsidian.json"

if exist "!OBS_CONFIG!" (
    echo Detected Obsidian config at !OBS_CONFIG!
    echo Scanning for vaults...
    echo.

    for /f "usebackq tokens=*" %%L in (`powershell -NoProfile -Command "(Get-Content '!OBS_CONFIG!' | ConvertFrom-Json).vaults.PSObject.Properties | ForEach-Object { $_.Value.path }"`) do (
        set "VAULT=%%L"
        if "!VAULT!" neq "" (
            call :install_vault "!VAULT!"
        )
    )
)

if !COUNT! equ 0 (
    echo No vaults detected automatically.
    echo.
    call :ask_for_vault
)

echo.
if !COUNT! equ 0 (
    echo No vaults were installed.
) else (
    echo Installed into !COUNT! vault^(s^).
    echo Restart Obsidian or enable the plugin in Settings ^> Community plugins.
)

echo.
pause
exit /b 0

:: ============================================================
:: Subroutines
:: ============================================================

:install_vault
set "V=%~1"
set "DEST=%V%\.obsidian\plugins\second-brain-builder"

if not exist "%V%\.obsidian" (
    echo   SKIP: %V% — .obsidian folder missing
    goto :eof
)

if not exist "%DEST%" mkdir "%DEST%"

copy /y "%SCRIPT_DIR%\main.js"       "%DEST%\main.js"       >nul
copy /y "%SCRIPT_DIR%\manifest.json" "%DEST%\manifest.json"  >nul
copy /y "%SCRIPT_DIR%\styles.css"    "%DEST%\styles.css"     >nul

echo   OK: %V%
set /a COUNT+=1
goto :eof

:ask_for_vault
echo Enter your Obsidian vault path (or press Enter to skip):
echo Example: C:\Users\YourUser\Documents\MyVault
echo.
set "USER_VAULT="
set /p "USER_VAULT=Vault path: "

if "!USER_VAULT!" equ "" goto :eof

if not exist "!USER_VAULT!" (
    echo   ERROR: Folder does not exist: !USER_VAULT!
    echo.
    call :ask_for_vault
    goto :eof
)

if not exist "!USER_VAULT!\.obsidian" (
    echo   WARNING: No .obsidian folder found. This may not be a vault.
    set /p "CONFIRM=Install anyway? (y/n): "
    if /i "!CONFIRM!" neq "y" (
        echo   Skipped.
        echo.
        call :ask_for_vault
        goto :eof
    )
)

call :install_vault "!USER_VAULT!"

echo.
set /p "MORE=Add another vault? (y/n): "
if /i "!MORE!" equ "y" (
    echo.
    call :ask_for_vault
)
goto :eof
