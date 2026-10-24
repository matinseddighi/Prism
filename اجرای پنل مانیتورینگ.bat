@echo off
chcp 65001 >nul
title Pricing Monitor
cd /d "%~dp0monitor"
where py >nul 2>nul
if %errorlevel%==0 (py -3 server.py) else (python server.py)
if errorlevel 1 pause
