@echo off
cd /d "%~dp0"
if not exist node_modules npm install
node bot.js
pause
