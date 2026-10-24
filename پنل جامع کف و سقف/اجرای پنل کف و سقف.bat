@echo off
chcp 65001 >nul
title ShelfMaster - پنل جامع مدیریت کف و سقف
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py -3 server.py) else (python server.py)
if errorlevel 1 pause
