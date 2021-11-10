#!/usr/bin/env bash

tsc src/**/*.js --declaration --allowJs --emitDeclarationOnly --outDir "@types/scratch-vm"
