@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   韭研 · 投研工作台
echo   启动后浏览器打开：http://localhost:8080
echo   关闭本窗口或按 Ctrl+C 即可停止服务
echo ================================================
node server.js
pause
