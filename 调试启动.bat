@echo off
cd /d "%~dp0"
echo 正在启动应用坞 AppDock...
echo 关闭窗口后会自动同步并关闭程序
echo.
node main.js
echo.
echo 程序已退出，窗口如未关闭请手动关闭。
pause >nul
