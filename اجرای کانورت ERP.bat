@echo off
chcp 65001 >nul
title ERP Converter
cd /d "%~dp0ERPConverter"
where py >nul 2>nul
if %errorlevel%==0 (py -3 server.py) else (python server.py)
if errorlevel 1 pause
