@echo off
title Quanta - physics audio visualizer
echo Starting Quanta...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
