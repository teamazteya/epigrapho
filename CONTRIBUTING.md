# Cómo contribuir

Gracias por querer mejorar Epigrapho.

## Reportar un problema o sugerir algo

Abre un [issue](https://github.com/teamazteya/epigrapho/issues/new) con:

1. Los pasos exactos para reproducir el problema.
2. Una captura o video, si ayuda.
3. La versión de la app y tu sistema operativo (Ajustes → Acerca de → Versión → Copiar).

Para algo privado, escribe a support@azteya.tech.

## Enviar cambios

1. Crea una rama a partir de `main`.
2. Sigue el estilo del código que tocas; `npx prettier --write` sobre los archivos cambiados.
3. Si cambias algo que la persona ve, corre el oráculo de `apps/desktop/scripts` que lo cubre (o agrega uno).
4. El mensaje de commit empieza con el área que cambia (`desktop:`, `web:`, `editor:`, `intl:`, …); la lista completa está en `.commitlintrc.js`.

Al contribuir aceptas que tu aporte se distribuya bajo la licencia GPL-3.0-or-later del proyecto.
