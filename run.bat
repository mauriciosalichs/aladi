@echo off
setlocal EnableDelayedExpansion

:: ══════════════════════════════════════════════════════════════════════
::  Aladí Library Portal — Windows Launcher / First-Run Setup
::
::  What this script does (in order):
::    1. Detects Python 3.10+ in PATH or common install paths
::    2. If missing, installs Python 3.12 silently (winget or direct
::       download — no administrator rights required)
::    3. Creates a Python virtual environment (.venv)
::    4. Installs / upgrades all required packages
::    5. Frees port 5000 if something is already using it
::    6. Launches the Flask server as a hidden background process
::    7. Opens http://localhost:5000 in the default browser
::    8. Creates a shortcut "Aladi.lnk" on the Desktop
:: ══════════════════════════════════════════════════════════════════════

:: ── Resolve directory of this script (remove trailing backslash) ─────
set "SCRIPT_DIR=%~dp0"
if "!SCRIPT_DIR:~-1!" == "\" set "SCRIPT_DIR=!SCRIPT_DIR:~0,-1!"
set "VENV_DIR=!SCRIPT_DIR!\.venv"
set "APP_PORT=5000"
set "PYTHON_EXE="

echo.
echo  =============================================================
echo   Aladí Library Portal  ^|  Windows Launcher
echo  =============================================================
echo.

:: ─────────────────────────────────────────────────────────────────────
:: Step 1 — Locate Python 3.10+ (or install it)
:: ─────────────────────────────────────────────────────────────────────
call :find_python
if "!PYTHON_EXE!" == "" (
    echo  [SETUP] Python 3.10+ not found. Installing Python 3.12 ...
    call :install_python
    if errorlevel 1 goto :fatal
    :: Re-scan; winget / installer puts Python in a known location
    call :find_python
)
if "!PYTHON_EXE!" == "" (
    echo.
    echo  [ERROR] Python 3.10+ could not be located after installation.
    echo          Please install it manually: https://www.python.org/downloads/
    goto :fatal
)
echo  [OK]    Python  : !PYTHON_EXE!

:: ─────────────────────────────────────────────────────────────────────
:: Step 2 — Create virtual environment
:: ─────────────────────────────────────────────────────────────────────
if not exist "!VENV_DIR!\Scripts\python.exe" (
    echo  [SETUP] Creating virtual environment ...
    "!PYTHON_EXE!" -m venv "!VENV_DIR!"
    if errorlevel 1 (
        echo  [ERROR] Could not create virtual environment.
        goto :fatal
    )
    echo  [OK]    Virtual environment created.
) else (
    echo  [OK]    Virtual environment already present.
)

:: ─────────────────────────────────────────────────────────────────────
:: Step 3 — Bootstrap & upgrade pip, then install required packages
::   Using `python -m ensurepip` + `python -m pip` (recommended on
::   Windows) to guarantee pip is present even on stripped installs.
::   Packages:
::   • flask          — web framework
::   • requests       — HTTP client (aladi_client.py)
::   • beautifulsoup4 — HTML scraper (aladi_client.py)
::   • lxml           — fast XML/HTML parser (optional but preferred)
:: ─────────────────────────────────────────────────────────────────────
echo  [SETUP] Bootstrapping pip inside the virtual environment ...
"!VENV_DIR!\Scripts\python.exe" -m ensurepip --upgrade
if errorlevel 1 (
    echo  [WARN]  ensurepip returned non-zero ^(may be harmless^).
)
"!VENV_DIR!\Scripts\python.exe" -m pip install --quiet --upgrade pip
if errorlevel 1 (
    echo  [ERROR] Could not upgrade pip.
    goto :fatal
)
echo  [OK]    pip upgraded.

echo  [SETUP] Installing packages (flask, requests, beautifulsoup4, lxml) ...
"!VENV_DIR!\Scripts\python.exe" -m pip install --quiet --upgrade ^
    flask requests beautifulsoup4 lxml
if errorlevel 1 (
    echo  [ERROR] Package installation failed.
    goto :fatal
)
echo  [OK]    Packages ready.
echo.

:: ─────────────────────────────────────────────────────────────────────
:: Step 4 — Free port 5000 (kill any LISTENING process on that port)
:: ─────────────────────────────────────────────────────────────────────
echo  [INFO]  Releasing port %APP_PORT% if occupied ...
for /f "tokens=5" %%P in ('netstat -aon 2^>nul ^| findstr "LISTENING" ^| findstr ":%APP_PORT% "') do (
    taskkill /F /PID %%P >nul 2>&1
)

:: ─────────────────────────────────────────────────────────────────────
:: Step 5 — Start Flask server as a hidden background process
::   Start-Process with -WindowStyle Hidden creates a fully detached
::   process that survives this script/window being closed.
:: ─────────────────────────────────────────────────────────────────────
echo  [INFO]  Starting Aladi server (http://localhost:%APP_PORT%) ...
set "_py=!VENV_DIR!\Scripts\python.exe"
set "_app=!SCRIPT_DIR!\app.py"
set "_wd=!SCRIPT_DIR!"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Start-Process -FilePath '!_py!' -ArgumentList '!_app!' -WorkingDirectory '!_wd!' -WindowStyle Hidden"
:: Give Flask a moment to bind the port before opening the browser
timeout /t 2 /nobreak >nul

:: ─────────────────────────────────────────────────────────────────────
:: Step 6 — Open default browser
:: ─────────────────────────────────────────────────────────────────────
echo  [INFO]  Opening browser ...
start "" "http://localhost:%APP_PORT%"

:: ─────────────────────────────────────────────────────────────────────
:: Step 7 — Desktop shortcut
:: ─────────────────────────────────────────────────────────────────────
call :create_shortcut

echo.
echo  =============================================================
echo   Aladi is running  >>  http://localhost:%APP_PORT%
echo   The server stays running after you close this window.
echo   Run run.bat again to restart it.
echo  =============================================================
echo.
goto :eof


:: ═══════════════════════════════════════════════════════════════════════
::  SUBROUTINES
:: ═══════════════════════════════════════════════════════════════════════

:: ── find_python ────────────────────────────────────────────────────────
:: Sets PYTHON_EXE to a Python 3.10+ executable (command name or full
:: path). Checks PATH commands first, then common per-user install dirs.
:find_python
:: PATH-based candidates
for %%C in (python py python3) do (
    if "!PYTHON_EXE!" == "" (
        where %%C >nul 2>&1
        if not errorlevel 1 (
            "%%C" -c "import sys;assert sys.version_info>=(3,10)" >nul 2>&1
            if not errorlevel 1 set "PYTHON_EXE=%%C"
        )
    )
)
if not "!PYTHON_EXE!" == "" goto :eof

:: Per-user installation paths (winget / official installer default)
:: Check newest versions first: 3.13, 3.12, 3.11, 3.10
for %%V in (313 312 311 310) do (
    if "!PYTHON_EXE!" == "" (
        set "_candidate=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
        if exist "!_candidate!" (
            "!_candidate!" -c "import sys;assert sys.version_info>=(3,10)" >nul 2>&1
            if not errorlevel 1 set "PYTHON_EXE=!_candidate!"
        )
    )
)
goto :eof


:: ── install_python ──────────────────────────────────────────────────────
:: Tries winget first, then falls back to downloading the official
:: installer from python.org. No administrator rights are required
:: (InstallAllUsers=0 installs for the current user only).
:install_python
where winget >nul 2>&1
if not errorlevel 1 (
    echo  [SETUP] Installing Python 3.12 via winget ...
    winget install --id Python.Python.3.12 --silent ^
        --accept-package-agreements --accept-source-agreements
    if not errorlevel 1 (
        echo  [OK]    Python 3.12 installed via winget.
        goto :eof
    )
    echo  [WARN]  winget failed. Falling back to direct download ...
)

:: Direct download from python.org (~28 MB)
set "_pyurl=https://www.python.org/ftp/python/3.12.4/python-3.12.4-amd64.exe"
set "_pyinst=%TEMP%\python312_setup.exe"
echo  [SETUP] Downloading Python 3.12.4 from python.org ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Invoke-WebRequest -Uri '!_pyurl!' -OutFile '!_pyinst!'"
if errorlevel 1 (
    echo  [ERROR] Download failed. Please check your internet connection.
    exit /b 1
)

echo  [SETUP] Running installer silently (user-level, no admin needed) ...
"!_pyinst!" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0
if errorlevel 1 (
    echo  [ERROR] Python installer exited with an error.
    del /f "!_pyinst!" >nul 2>&1
    exit /b 1
)
del /f "!_pyinst!" >nul 2>&1
echo  [OK]    Python 3.12 installed.
goto :eof


:: ── create_shortcut ─────────────────────────────────────────────────────
:: Writes a PowerShell script to %TEMP%, executes it, then deletes it.
:: Using a temp file avoids the quoting hell of inline -Command strings.
:: [Environment]::GetFolderPath('Desktop') handles OneDrive-relocated
:: desktops correctly.
:create_shortcut
echo  [SETUP] Creating Desktop shortcut (Aladi.lnk) ...
set "_pstmp=%TEMP%\aladi_mkshortcut_%RANDOM%.ps1"
(
    echo $ws      = New-Object -ComObject WScript.Shell
    echo $desktop = [Environment]::GetFolderPath^('Desktop'^)
    echo $lnk     = $ws.CreateShortcut^($desktop + '\Aladi.lnk'^)
    echo $lnk.TargetPath       = '%SCRIPT_DIR%\run.bat'
    echo $lnk.WorkingDirectory  = '%SCRIPT_DIR%'
    echo $lnk.WindowStyle       = 1
    echo $lnk.IconLocation      = 'shell32.dll,13'
    echo $lnk.Description       = 'Aladi Library Portal'
    echo $lnk.Save^(^)
    echo Write-Host "  [OK]    Shortcut: $desktop\Aladi.lnk"
) > "!_pstmp!"
powershell -NoProfile -ExecutionPolicy Bypass -File "!_pstmp!"
del /f "!_pstmp!" >nul 2>&1
goto :eof


:: ── :fatal ─────────────────────────────────────────────────────────────
:fatal
echo.
echo  Press any key to exit ...
pause >nul
exit /b 1
