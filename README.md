<p align="center">
<img src="./assets/brand/epigrapho-logo.png" alt="Epigrapho" width="100" />
</p>

<h1 align="center">Epigrapho</h1>
<h3 align="center">Notas privadas que entienden referencias bíblicas.</h3>

## Qué es

Epigrapho es una app de notas local y cifrada en la que una referencia bíblica es un objeto, no un texto suelto. Al escribir «Juan 3:16» (o «Juan 3,16», o «John 3:16») la app la reconoce, la guarda en formato USFM (`JHN.3.16`) y muestra el versículo al pasar el cursor.

- **Traducciones sin conexión:** VBL (CC BY-SA 4.0), BSB, KJV y PdDpt (CC BY 4.0) vienen dentro de la app.
- **Traducciones en línea:** NTV, NBLA y NASB se piden a API.Bible con una llave que vive fuera del repositorio y solo la lee el proceso principal. Ningún texto de tus notas sale del equipo.
- **Referencias:** marcas, bloques de Escritura, backlinks entre notas que citan el mismo pasaje y búsqueda por pasaje.
- **Corrector ortográfico sin conexión:** español e inglés, con un paquete de términos bíblicos y tu propio diccionario.
- **Sin cuentas ni suscripciones:** todo lo que la app puede hacer por sí sola está disponible.

## Desarrollo

Requisitos: Node 22.23.2 y npm.

```bash
npm ci --ignore-scripts
npm run bootstrap -- --scope=web
npm run bootstrap -- --scope=desktop
npm run start:desktop
```

Instalador de Windows, macOS o Linux (lo mismo que hace `.github/workflows/epigrapho.installers.yml`):

```bash
cd apps/desktop
node scripts/build.mjs --rebuild
npm exec --no -- electron-builder install-app-deps
npx electron-builder --config=electron-builder.config.js --publish=never
```

Los paquetes de Linux (AppImage, `.deb` para Debian y Ubuntu, `.rpm` para Fedora, `.pacman` para Arch y CachyOS) se hacen en Linux con los mismos pasos, después de instalar `rpm` y `libarchive-tools`; el workflow lo hace en Ubuntu.

Las verificaciones de extremo a extremo están en `apps/desktop/scripts/a0-*.mjs` y `a1-*.mjs`; se ejecutan con `npm run start:desktop` corriendo.

## Soporte

- Correo: support@azteya.tech
- Reportes y sugerencias: [issues](https://github.com/teamazteya/epigrapho/issues/new)

## Licencia

GPL-3.0-or-later. Epigrapho es una versión modificada de [Notesnook](https://github.com/streetwriters/notesnook) (© Streetwriters), distribuida bajo la misma licencia; ver [LICENSE](./LICENSE) y [AUTHORS](./AUTHORS).
