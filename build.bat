@echo off
:build
if not exist "%CD%\node_modules" goto install

npm run dist 
pause
exit
:install
npm install
goto build