# Aviso de privacidad de Epigrapho

Última actualización: 2 de octubre de 2026.

Epigrapho es una app de notas para estudiar la Biblia. La hace Azteya. Este aviso explica qué datos tuyos guarda Epigrapho, dónde los guarda y cómo los borras.

## Sin cuenta

Puedes usar Epigrapho sin crear una cuenta. En ese caso tus notas viven solo en tu computadora, cifradas, y Epigrapho no las envía a ningún servidor.

Hay una sola excepción, y no depende de tener cuenta: las traducciones que solo funcionan en línea (NTV, NBLA y NASB). Para mostrar uno de esos versículos, la app le pide la referencia, por ejemplo `JHN.3.16`, al servidor de Epigrapho (`notas.azteya.tech`), que a su vez se la pide a API.Bible. Solo envía la referencia, y el servidor no guarda quién la pidió. El texto de tus notas nunca sale de tu equipo.

El corrector gramatical (LanguageTool) corre dentro de tu computadora y tampoco envía nada.

## Con cuenta

La cuenta es opcional y gratuita. Sirve para una sola cosa: que tus notas sean las mismas en todas las computadoras donde inicias sesión.

Tu cuenta de Epigrapho vive en el servidor de Epigrapho y no tiene ninguna relación con Notesnook, aunque la app se base en Notesnook. Si tienes una cuenta de Notesnook con el mismo correo, son dos cuentas distintas: ninguna ve ni toca los datos de la otra.

### Qué guarda el servidor

- **Tu correo.** Con él inicias sesión, y a él te enviamos la confirmación, los códigos de verificación en dos pasos y los enlaces de recuperación.
- **Un hash de tu contraseña.** Tu contraseña nunca llega al servidor tal cual: la app la transforma antes de enviarla, y el servidor guarda solo un hash de esa transformación.
- **Tus datos cifrados**: notas, libretas, etiquetas, recordatorios, adjuntos, tu traducción preferida y tu diccionario. Se cifran en tu computadora antes de salir de ella, con una llave que solo tú tienes. El servidor no puede leerlos, y nosotros tampoco.
- **Datos técnicos para que el sync funcione**: el tamaño de cada elemento y de tus adjuntos, las fechas en que cambiaron, y un identificador por cada computadora donde inicias sesión.
- **Registros técnicos del servidor**, que pueden incluir la dirección IP desde la que te conectas. Sirven para atender fallas y ataques. Se borran solos: el servidor conserva unos pocos megabytes por servicio y descarta lo más viejo.

No guardamos tu contraseña, ni tu llave de cifrado, ni el contenido de tus notas sin cifrar, salvo las que compartes con un enlace (abajo, en "Notas compartidas"). No hay analíticas ni venta de datos, y solo recibes correos de novedades si los pides.

### Dónde

El servidor corre en Oracle Cloud, en la región de Querétaro, México. Los respaldos del servidor se guardan en la misma región, también cifrados, durante 28 días como máximo.

Los correos los envía Brevo, el servicio de correo que usamos. Brevo recibe tu dirección y el texto del correo (por ejemplo, un código de verificación), pero nunca tus notas.

### Correos de novedades

Solo si lo aceptas (al crear tu cuenta o en Ajustes → Privacidad), te enviamos novedades y ofertas de Epigrapho, una vez al mes como máximo. Para eso guardamos en El Dugout, el sistema de contactos de Azteya, tu correo, el idioma de la app, la fecha en que creaste tu cuenta y si aceptaste. Nada más: ni tus notas ni cómo usas la app.

Si desmarcas la opción en la app, dejas de recibirlos en ese momento. Cada correo trae además un enlace para darte de baja de todos los correos de Azteya. Si borras tu cuenta, también dejas de recibir los correos de novedades de Epigrapho. Tu correo se queda en El Dugout, así que puedes seguir recibiendo los correos generales de Azteya, que también traen el enlace para darte de baja.

### Notas compartidas

Si compartes una nota con un enlace, el servidor guarda una copia que cualquiera con el enlace puede leer, incluido el servidor: esa copia ya no está cifrada de extremo a extremo. Si le pones contraseña, la copia va cifrada con ella y el servidor no puede leerla. También contamos cuántas veces se abrió, sin saber quién la abrió. Las imágenes de la nota se publican con ella; los demás adjuntos, no. La copia vive en el mismo servidor, en Querétaro.

La copia se borra cuando dejas de compartirla, cuando borras tu cuenta, o la primera vez que alguien la abre si elegiste que se borre después de leerla.

**Qué no se puede publicar:** nada ilegal, spam ni engaños, ni datos personales de otras personas sin su permiso. Si alguien reporta una nota que rompe estas reglas, Azteya puede despublicarla. Para reportar, usa el botón "Reportar" de la página o escribe a support@azteya.tech.

### Quién lo opera

Azteya opera el servidor. Para cualquier pregunta sobre tus datos, escribe a support@azteya.tech.

El código de la app y el del servidor son libres, así que cualquiera puede revisar que hacen lo que dice este aviso: [teamazteya/epigrapho](https://github.com/teamazteya/epigrapho) y [teamazteya/epigrapho-sync-server](https://github.com/teamazteya/epigrapho-sync-server).

## Cómo borrar tu cuenta

En la app, ve a Ajustes → Perfil → **Borrar la cuenta** y escribe tu contraseña. El servidor borra tu cuenta y todos tus datos en ese momento. Las copias de respaldo del servidor desaparecen solas en un máximo de 28 días.

Al borrar la cuenta, la app también borra las notas de cada computadora donde tenías la sesión iniciada. Si quieres conservar una copia, haz antes un respaldo en Ajustes → Respaldo y exportación.

Si ya no puedes entrar a tu cuenta, escribe a support@azteya.tech desde el correo de la cuenta y la borramos.

## Cambios a este aviso

Si cambia algo de lo que se describe aquí, actualizaremos este archivo y la fecha de arriba. Si el cambio es importante, también lo diremos en las novedades de la versión que lo traiga.
