@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: ====================================================
::   CLUB CONNECT - APK Builder
:: ====================================================

echo.
echo  ============================================
echo     CLUB CONNECT - APK Builder
echo  ============================================
echo.

:: ---------- Set Environment Variables ----------
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

:: ---------- Check if Android SDK exists ----------
if not exist "%ANDROID_HOME%" (
    echo  [ERROR] Android SDK not found at %ANDROID_HOME%
    echo  Please install Android Studio first.
    pause
    exit /b 1
)

if not exist "%JAVA_HOME%\bin\java.exe" (
    echo  [ERROR] Java not found at %JAVA_HOME%
    echo  Please install Android Studio first.
    pause
    exit /b 1
)

echo  [OK] Android SDK found
echo  [OK] Java found

:: ---------- Step 1: Sync web assets ----------
echo.
echo  [STEP 1/3] Syncing frontend files to Android project...
call npx cap sync android
if errorlevel 1 (
    echo  [ERROR] Capacitor sync failed!
    pause
    exit /b 1
)
echo  [OK] Frontend synced!

:: ---------- Step 2: Build APK ----------
echo.
echo  [STEP 2/3] Building APK... (this may take 1-2 minutes)
cd android
call gradlew.bat assembleDebug
if errorlevel 1 (
    echo.
    echo  [ERROR] APK build failed!
    cd ..
    pause
    exit /b 1
)
cd ..
echo  [OK] APK built successfully!

:: ---------- Step 3: Copy APK to Desktop ----------
echo.
echo  [STEP 3/3] Copying APK to Desktop...
set "APK_SOURCE=android\app\build\outputs\apk\debug\app-debug.apk"
set "APK_DEST=%USERPROFILE%\Desktop\ClubConnect.apk"

if exist "%APK_SOURCE%" (
    copy /Y "%APK_SOURCE%" "%APK_DEST%" >nul 2>&1
    echo  [OK] APK copied to Desktop!
) else (
    echo  [ERROR] APK file not found!
    pause
    exit /b 1
)

echo.
echo  ============================================
echo     BUILD COMPLETE!
echo  ============================================
echo.
echo  APK Location: %APK_DEST%
echo.
echo  Now send this APK to your phone and install it!
echo.
pause
