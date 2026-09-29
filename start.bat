@echo off
rem WarRoom one-click launcher (Windows): builds the web app and serves everything from one
rem server at http://localhost:8020. Leave this window open while you demo; close it to stop.
cd /d "%~dp0"

if not exist .env (
  echo No .env file found. Copy .env.example to .env and fill in GROQ_API_KEY and the HINDSIGHT_ keys.
  pause
  exit /b 1
)

if not exist .venv\Scripts\python.exe (
  echo [1/3] Creating the Python environment ^(first run only^)...
  python -m venv .venv || goto :fail
  .venv\Scripts\python.exe -m pip install -q -r requirements.txt || goto :fail
)

if not exist frontend\node_modules (
  echo [2/3] Installing web app packages ^(first run only^)...
  call npm --prefix frontend install --no-audit --no-fund || goto :fail
)

echo [3/3] Building the web app...
call npm --prefix frontend run build || goto :fail

echo.
echo WarRoom is starting at http://localhost:8020  ^(the page connects by itself once the server is up^)
start "" http://localhost:8020
.venv\Scripts\python.exe -m uvicorn app.api:app --port 8020
goto :eof

:fail
echo.
echo Something went wrong above. Fix it and run start.bat again.
pause
exit /b 1
