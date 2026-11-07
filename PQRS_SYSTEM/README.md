# PQRS Serranía SAS ESP

Plataforma de atención al usuario de una empresa de residuos sólidos, conectada a MySQL con consultas manuales y un dashboard exclusivo para administradores.

## Canal público

- `/`: página principal con accesos a registro, consulta y administración.
- `/pqrs/nueva`: registro sin cuenta. Los datos personales son obligatorios: nombre, tipo y número de documento, grupo étnico (incluye «No aplica»), correo, teléfono y dirección. También requiere servicio, tipo de PQRS, asunto, descripción y autorización de tratamiento de datos.
- Tipos de documento: cédula de ciudadanía, cédula de extranjería, pasaporte y NIT. El número admite de 3 a 30 caracteres alfanuméricos, puntos, espacios y guiones.
- Grupos étnicos: indígena, gitano o Rrom, negro(a) afrodescendiente, afrocolombiano(a), palenquero(a), raizal y no aplica. Se informa que es un dato sensible; «No aplica» permite no declarar pertenencia étnica. La autorización del formulario menciona expresamente la información que se decida declarar.
- Adjunto opcional: un JPG/JPEG, PNG o PDF de hasta **10 MB (10.485.760 bytes)**. Se comprueban tamaño, extensión, MIME y firma inicial del archivo. Esto no sustituye un análisis antivirus. Si hay errores de validación, los datos de texto se conservan, pero debe volver a seleccionar el archivo.
- Cada solicitud recibe un ticket aleatorio único `SER-` seguido de 24 caracteres hexadecimales. Se muestra en la confirmación y se encolan las notificaciones descritas en la sección de correo.
- `/consultar`: consulta por ticket, incluso desde otro dispositivo, con estado actual, trayectoria y respuestas oficiales.
- La consulta no expone nombre, documento, grupo étnico, correo, teléfono, dirección, adjunto ni descripción original. Quien conozca el ticket puede leer las respuestas oficiales: conserve el ticket en privado y no incluya datos personales en las respuestas del administrador.
- Estados: `Abierto`, `En proceso`, `Solucionado`. El registro público siempre inicia en `Abierto`, sin aceptar estados o responsables enviados por el navegador.
- Cada formulario incluye un identificador de envío firmado y ligado a la sesión. Los reintentos y envíos simultáneos de ese mismo formulario recuperan el ticket original mediante un índice único en MySQL, sin duplicar la solicitud ni el historial. Para registrar otra PQRS, abra un nuevo formulario. La protección persiste en la base, no depende solo del botón deshabilitado.
- El teléfono admite entre 7 y 15 dígitos, un `+` inicial opcional, espacios, guiones y paréntesis, con un máximo de 30 caracteres en total.
- Las direcciones inexistentes presentan una página 404 con enlaces al inicio y a la consulta.

## Administración y actualización de instalaciones existentes

El panel `/admin` está reservado a cuentas `ADMINISTRADOR`; allí se listan y buscan tickets, se revisan datos de contacto, se responde y se cambia el estado. El detalle muestra el historial de estados y las respuestas. Una PQRS solucionada no admite más respuestas mientras conserve ese estado.

Al crear una cuenta, el administrador puede elegir `CONSULTA_PQRS`. Esta cuenta inicia en `/consulta-pqrs` y solo puede consultar el listado y los detalles limitados de todas las solicitudes: ticket, tipo, asunto, estado, fechas, descripción y respuestas. No puede acceder al panel administrativo, usuarios, reportes, cambios, respuestas nuevas ni archivos adjuntos. Las consultas SQL y vistas de ese rol excluyen correo, teléfono, dirección, documento, grupo étnico, comentarios internos y autores de respuestas. El acceso sigue requiriendo que el administrador cree y active la cuenta.

Al crear cuentas administrativas o de consulta, puede asociarse una persona existente sin cuenta o registrar una persona nueva desde el mismo formulario. La creación de la persona y la cuenta se guarda en una sola transacción; si falla el usuario (por nombre o documento duplicado, por ejemplo), tampoco queda una persona huérfana.

Las rutas antiguas `/resident` ya no habilitan un panel ni permiten crear, editar o responder solicitudes. Las cuentas antiguas se conservan, pero no pueden iniciar sesión administrativa. No se generan nuevas cuentas de residentes automáticamente. Los usuarios del servicio utilizan el canal público.

Antes de actualizar una base existente, haga una copia de seguridad. Al arrancar, una migración idempotente:

1. Permite valores nulos en las relaciones de PQRS con persona y unidad, para no exigir una vivienda ni crear cuentas públicas.
2. Agrega contacto, dirección, servicio y un ticket con índice único.
3. Asigna un ticket a las PQRS anteriores sin eliminar sus relaciones, respuestas ni historial.
4. Agrega un identificador de envío opcional con índice único para evitar duplicados; los registros anteriores se conservan con ese campo vacío.
5. Agrega documento y grupo étnico sin inventar datos para registros anteriores, y la tabla privada `adjunto_pqrs`. Los archivos se guardan junto con la solicitud en una transacción; no se publican en la carpeta estática. Se descargan solo desde una ruta administrativa y se eliminan al borrar la PQRS.

Se mantiene el nombre de base `gestion_conjuntos` por compatibilidad. El usuario MySQL necesita permisos de `CREATE`, `ALTER`, `SELECT`, `INSERT` y `UPDATE` para la migración inicial. La aplicación conserva las tablas residenciales anteriores para no destruir datos. Configure `max_allowed_packet` de MySQL por encima de 10 MB para guardar los adjuntos (por ejemplo, 16 MB o más) y respalde también la nueva tabla, ya que contiene los archivos.

La interfaz utiliza la paleta verde, azul y cian de la referencia suministrada y el logotipo proporcionado en `public/images/serrania-logo.png`. Aparece en la cabecera pública, el ingreso y el panel administrativo, con enlace al inicio, nombre accesible, proporciones originales y espacio de separación. Su tamaño se adapta a la pantalla sin ampliar la imagen por encima de su resolución original. También se usa como icono de pestaña. Estas medidas siguen buenas prácticas web; no sustituyen un manual institucional de identidad visual.

La cabecera pública respeta el formato horizontal del logo (640 × 200). En computadores y tabletas aparece a la izquierda, con un ancho adaptable de 220 a 360 px y el menú a la derecha. En teléfonos se centra sobre el menú, con un ancho de 240 a 300 px limitado al espacio disponible; los enlaces se organizan en dos columnas con áreas táctiles de al menos 44 px de alto. No se recorta ni deforma la imagen. El ingreso y el panel administrativo conservan sus tamaños independientes.

La página principal utiliza una portada fotográfica y fondos azul, cian y verde inspirados en el logo, sin carrusel. Debajo hay tres tarjetas: rutas y horarios, tarifas y oficinas. Según el texto suministrado, la recolección habitual es lunes y viernes en El Cairo y Albán, sin hora especificada; se distingue la operación temporal de cuatro veces por semana por el sismo del 10 de agosto de 2026. Se resumen el barrido de seis días, su turno de ocho horas desde las 7:00 a. m., las macrorrutas y el aprovechamiento semanal; el esquema propuesto se marca como aún en validación. La tabla de tarifas reproduce los valores y subsidios de la Tabla 10, sin inventar periodicidad ni vigencia. La oficina está en Carrera 5 con Calle 9, Palacio Municipal, segundo piso; la futura ECA junto a la Policía se indica como no operativa. Las tarjetas conservan sus colores y se ajustan a una columna en teléfonos; la tabla admite desplazamiento horizontal sin ampliar la página. Las fotografías originales y sus versiones WebP permanecen disponibles en `public/images/carrusel`.

El lobby presenta una portada de ancho completo que integra la bienvenida y `IMG_3140.webp` en un solo contenedor. La foto se ajusta con `object-fit: cover`, con encuadre responsive y un degradado azul/verde más intenso en el borde del texto. La portada se desplaza con la página; reemplaza el anterior fondo fijo. Atención ciudadana y Quiénes somos conservan sus fondos propios.

La sección muestra un único mapa de Google Maps con el marcador de la sede 1 en `4.7625753,-76.220856`, con zoom inicial 18. Conserva enlaces externos para la sede 1 y la sede 2 en `4.762922955561891,-76.22051294710205`. La sede 2 no se marca dentro del mapa. Se usan latitud y longitud; el tercer valor suministrado para la sede 1 (`20.6`) no forma parte de las coordenadas geográficas.

El mapa se integra mediante un iframe de Google Maps con título accesible y carga diferida, sin clave API. Se adapta al ancho disponible, con altura de 300 a 480 px. Requiere internet y se conecta a Google, sin enviar datos del formulario PQRS. Los enlaces externos permiten abrir cada sede aunque el mapa no cargue. No se utilizan Leaflet, CARTO ni OpenStreetMap.

El footer compartido de las páginas públicas presenta cuatro tarjetas: empresa, información legal (NIT 901974106 y matrícula de Cámara de Comercio pendiente de publicación), contacto institucional y dirección. El perfil del panel administrativo muestra el NIT 901974106, el correo `subaseopqrds@elcairo-valle.gov.co` y el teléfono +57 320 314 3660, además de los datos del administrador. Debajo, el footer incluye iconos SVG locales con nombres accesibles y enlaces oficiales de Instagram, Facebook y WhatsApp (+57 320 314 3660), además de los derechos reservados de 2026. Las tarjetas pasan de cuatro columnas a dos en tabletas y una en teléfonos. Los datos y enlaces se mantienen en `views/partials/public-footer.ejs`.

## Requisitos

Los iconos sociales se ubican en la franja inferior del footer junto a los derechos reservados, reemplazando el enlace «Volver al inicio». En teléfonos se apilan y centran; los enlaces mantienen áreas táctiles de 48 px.

- Node.js 20 o superior (requerido por el cliente de correo)
- MySQL Server 8.0 o superior

## Instalación

1. Inicie el servidor MySQL local. Si se instaló sin un servicio de Windows, en PowerShell inicialice el directorio de datos una sola vez y luego arranque el servidor:
   ```powershell
   $base = Join-Path $env:ProgramFiles 'MySQL\MySQL Server 8.4'
   $data = Join-Path $env:LOCALAPPDATA 'MySQL\data'
   $server = Join-Path $base 'bin\mysqld.exe'
   if (-not (Test-Path (Join-Path $data 'auto.cnf'))) {
     New-Item -ItemType Directory -Force $data | Out-Null
     & $server --initialize-insecure "--basedir=$base" "--datadir=$data" --console
     if ($LASTEXITCODE -ne 0) { throw 'No se pudo inicializar MySQL.' }
   }
   if (-not (Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue)) {
     Start-Process -FilePath $server -ArgumentList "--basedir=`"$base`" --datadir=`"$data`" --port=3306 --bind-address=127.0.0.1 --mysqlx=0" -WindowStyle Hidden
     Start-Sleep -Seconds 5
   }
   ```
   MySQL queda limitado a conexiones locales. La inicialización crea `root` sin contraseña; úselo solo para desarrollo local.
2. Desde PowerShell, en la carpeta `PQRS_SYSTEM`, cargue el esquema local y los datos de prueba:
   ```powershell
   $mysql = Join-Path $env:ProgramFiles 'MySQL\MySQL Server 8.4\bin\mysql.exe'
   Get-Content -Raw .\scripts\local-mysql.sql | & $mysql --protocol=tcp --host=127.0.0.1 --user=root
   ```
3. Configure `.env` con `DB_HOST=localhost`, `DB_PORT=3306`, `DB_USER=root`, `DB_PASSWORD=` y `DB_NAME=gestion_conjuntos`. No use las credenciales de un servidor remoto para las pruebas locales.
4. Instale dependencias con `npm install`.
5. Inicie la app con `npm run start` y deténgala con `npm run stop`.

El script `scripts/local-mysql.sql` crea las tablas y vistas originales y agrega datos residenciales de compatibilidad. El primer arranque aplica la adaptación y crea automáticamente la cuenta de administrador.

## Notificaciones por correo (Gmail / Google Workspace)

Cada nueva PQRS guarda, en la misma transacción del registro, una notificación para `PQRS_NOTIFICATION_EMAIL` (por defecto, `criscamilo555@gmail.com`) y otra para el correo suministrado por el solicitante. El destino puede ser un correo personal de Gmail; no necesita ser corporativo. Es independiente de `SMTP_USER`, que identifica la cuenta remitente. Si coinciden, se envía un solo mensaje. Los reintentos del mismo formulario no agregan notificaciones. El cambio de destino se aplica a nuevas solicitudes; las notificaciones ya guardadas conservan su destinatario. No se envían correos retroactivos de tickets existentes al instalar la migración.

Configure localmente estas variables en `.env` (no publique credenciales):

```dotenv
PQRS_NOTIFICATION_EMAIL=criscamilo555@gmail.com
SMTP_USER=subaseopqrds@elcairo-valle.gov.co
SMTP_PASSWORD=
APP_PUBLIC_URL=http://localhost:3000
```

En `SMTP_PASSWORD` ingrese una **contraseña de aplicación de Google**, no la contraseña normal. Requiere verificación en dos pasos y que el administrador de Google Workspace permita contraseñas de aplicación y SMTP. Si la organización las bloquea, será necesario configurar un método autorizado distinto antes de activar los envíos.

Ejecute `npm run mail:verify` para comprobar conexión y autenticación sin enviar correos. Reinicie la aplicación después de configurar las variables. Se utiliza `smtp.gmail.com:465` con TLS y el remitente es `SMTP_USER`.

El proceso del servidor revisa la cola persistente `notificacion_pqrs` cada cinco segundos y envía mensajes separados, sin revelar el correo del solicitante al otro destinatario. La confirmación HTML del cliente sigue la referencia visual: logo incorporado y centrado, agradecimiento, tarjeta verde con el ticket real, botón «Consultar mi PQRS» y footer azul/verde. La empresa recibe «¡Nueva PQRS recibida!», un saludo al colaborador, instrucciones de atención y gestión, tarjeta azul con el ticket y botón «Gestionar PQRS». El destinatario que coincide con `PQRS_NOTIFICATION_EMAIL` recibe el aviso empresarial; si el solicitante utiliza esa misma dirección, se conserva un solo envío con el aviso empresarial. Ambos mensajes incluyen una alternativa de texto plano. Solo se incorpora el logo local; no se envían documentos, grupo étnico, descripción ni archivos del solicitante. La pantalla de confirmación utiliza el mismo estilo y conserva la consulta mediante POST con su protección de formulario.

`APP_PUBLIC_URL` define la dirección de los botones: el cliente abre `/consultar` sin exponer el ticket en la URL y la empresa abre `/admin/pqrs`, donde debe iniciar sesión administrativa y buscar el ticket. El enlace no concede acceso ni evita la autenticación. Debe ser HTTP o HTTPS sin credenciales. Para pruebas se utiliza `http://localhost:3000`: solo funciona en el equipo del servidor. Antes de enviar a clientes en otros dispositivos, configure la URL pública HTTPS de la aplicación y reinicie. El formato de ticket sigue siendo `SER-` más 24 caracteres hexadecimales; no se usa el número ficticio de la referencia.

El pie de la notificación al cliente incluye un enlace a `www.serraniasas.com`; los botones de consulta se generan desde `APP_PUBLIC_URL`. Para producción, configure `APP_PUBLIC_URL=https://www.serraniasas.com` y `NODE_ENV=production` en el entorno del servidor. En producción, las cookies de sesión requieren HTTPS y se confía en un proxy inverso delante de Node; genere un `SESSION_SECRET` aleatorio de al menos 32 caracteres y no reutilice el valor local. Mantenga los datos de MySQL, las credenciales SMTP y el correo institucional (`PQRS_NOTIFICATION_EMAIL`) como secretos del proveedor, usando los valores que este suministre. No despliegue la configuración local de MySQL/XAMPP. La app aún usa sesiones en memoria; antes de escalar o reiniciar instancias en producción, configure un almacén persistente para sesiones.

Los fallos se registran con códigos sin credenciales ni direcciones personales y se reintentan con espera progresiva hasta una hora entre intentos. Sin contraseña configurada, la aplicación informa el problema en consola y conserva las notificaciones pendientes; **no significa que se hayan enviado**.

La columna `estado` permite verificar `pendiente`, `enviando` o `enviada`; `enviada` significa aceptación por el servidor SMTP, no entrega garantizada a la bandeja de entrada. Revise también spam. La cola sobrevive a reinicios y evita reprocesar mensajes ya marcados como enviados. Como en cualquier envío SMTP, una interrupción después de la aceptación y antes de guardar el resultado puede provocar un duplicado al reintentar; el `Message-ID` permanece estable. El servidor debe permanecer ejecutándose para procesar la cola. Al eliminar una PQRS se eliminan sus notificaciones pendientes y su registro de envío.

## Accesos por defecto

Las credenciales de prueba se encuentran en la sección **Credenciales de prueba** más abajo.

## Alcance funcional

- Inicio (`/`): lobby institucional con portada fotográfica y accesos a la empresa y atención ciudadana.
- Atención y servicios al ciudadano (`/atencion-ciudadano`): página PQRS independiente, sin carrusel, con registro y consulta por ticket. Las rutas existentes de registro y consulta se conservan.
- Quiénes somos (`/quienes-somos`): descripción de la empresa, visión al año 2030 y misión suministradas por la empresa. Los contenedores de objetivos generales y específicos permanecen pendientes. El contenido se mantiene en `views/public/about.ejs`.
- Gestor normativo (`/gestor-normativo`): contenedor del Contrato de Condiciones Uniformes (CCU), descripción y descarga pública del PDF mediante `/gestor-normativo/ccu/descargar`. Se conserva una copia en `public/documents/contrato-condiciones-uniformes.pdf` del [documento suministrado de Superservicios](https://www.superservicios.gov.co/sites/default/files/inline-files/Contrato-de-Condiciones-Uniformes.pdf); no se presenta como un contrato propio de Serranía. Para publicar el CCU de la empresa, reemplace el archivo y actualice la referencia en `views/public/regulatory.ejs`.
- Navegación compartida con sección activa; las páginas institucionales se ajustan a móviles, tabletas y computadores sin cambiar el acceso exclusivo del administrador al dashboard.
- Los cuatro enlaces institucionales del menú usan colores del logo al pasar el cursor o recibir foco de teclado, con elevación suave y sin movimiento cuando se solicita reducir animaciones. Administración conserva su estilo.
- El footer público comparte un fondo degradado azul y verde de la identidad del portal, con tarjetas claras y derechos reservados en blanco para conservar el contraste.
- El acceso administrativo muestra el logo horizontal ampliado y responsivo, y un botón «Volver al inicio» hacia el lobby público.
- La barra lateral administrativa muestra el logo horizontal de hasta 200 px, centrado sobre el nombre de la empresa y limitado al ancho disponible.
- Gestor normativo también incluye el Decreto 1077 de 2015 en un contenedor independiente y responsivo, con descarga del archivo local `public/documents/Decreto-1077-de-2015-Sector-Vivienda,-Ciudad-y-Territorio-Gestor-Normativo.pdf`.

- Registro público sin inicio de sesión, con validación y ticket único.
- Consulta de estado, historial y respuestas por ticket, desde el estado inicial.
- Dashboard, respuestas, edición, cambio de estado y eliminación exclusivos del administrador.
- Búsqueda por ticket, asunto, solicitante y dirección; filtros, ordenamiento y reportes.
- Reportes permite filtrar PQRS por búsqueda, estado y tipo y descargar un Excel `.xlsx` con los mismos filtros y orden. Incluye encabezados, columnas independientes, fechas, texto ajustado, primera fila fija y autofiltros de Excel. Los textos se exportan como valores, no fórmulas; teléfonos y tickets conservan su formato. Solo el administrador puede descargar estos datos. Los indicadores PQRS reflejan los filtros; los de usuarios siguen siendo globales.
- Gestión de cuentas administrativas y conservación de cuentas anteriores.

## Notas técnicas

- No se usa ORM ni abstracción de persistencia.
- El script local crea las tablas y vistas; el bootstrap migra las PQRS y asegura los estados y el administrador.
- La creación, los cambios de estado y las respuestas con cambio de estado usan transacciones para mantener consistente el historial.
- El estado `Cerrado` ya no forma parte del flujo funcional; el sistema trabaja con `Abierto`, `En proceso` y `Solucionado`.

## Cómo ejecutar la aplicación

Antes de arrancar la aplicación asegúrate de que MySQL esté iniciado y que exista la base local `gestion_conjuntos`.

Comandos básicos desde la carpeta del proyecto:

PowerShell / CMD (desde la carpeta del proyecto):
```powershell
# Instala dependencias
npm install
# Inicia el servidor en segundo plano y devuelve el control (crea server.pid)
npm run start
# Detiene el servidor (usa el PID guardado en server.pid)
npm run stop
```

Si necesitas ver logs en la misma terminal (modo foreground) para depuración, ejecuta directamente:

```powershell
node src/server.js
```

Detener la aplicación:

- Desde la misma terminal donde ejecutaste `npm run start`: presiona `Ctrl+C`.
- Desde cualquier otra terminal (Windows):
```powershell
npm run stop
```

- Forzar cierre (sólo si `npm run stop` no funciona):
```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

Parada segura (archivo PID)

La aplicación ahora escribe un archivo `server.pid` en la raíz del proyecto cuando se inicia con `npm run start`. Este archivo contiene el PID (identificador de proceso) del servidor en ejecución.

- `npm run stop` leerá `server.pid`, intentará enviar `SIGTERM` al proceso indicado y, como respaldo en Windows, usará `taskkill` si fuera necesario.
- Si `server.pid` no existe o contiene un PID inválido, `npm run stop` mostrará un mensaje de error y no intentará matar procesos arbitrarios.
- Después de una parada correcta, `server.pid` se borra automáticamente.

Esto evita matar otros procesos `node.exe` que puedas tener abiertos y es el método recomendado para detener la aplicación.

Archivos relevantes:

- [src/server.js](src/server.js) — escribe y elimina `server.pid` al iniciar/detener.
- [scripts/stop.js](scripts/stop.js) — script que lee `server.pid` y detiene sólo ese PID.
- [package.json](package.json) — `npm run start` y `npm run stop` están configurados para usar estos scripts.

## Credenciales de prueba

Usa estas cuentas para pruebas iniciales una vez que la BD y la app estén corriendo:

- Administrador (prueba): usuario `admin`, contraseña `Admin123*`

El alta de cuentas administrativas se realiza desde `/admin/usuarios`. El registro público es de PQRS, no de cuentas.

Antes de publicar, cambie la contraseña administrativa de prueba y `SESSION_SECRET`, configure HTTPS y una sesión persistente. El almacén de sesiones en memoria actual es solo apropiado para desarrollo. Revise también la política institucional de tratamiento de datos antes de usar el formulario con usuarios reales.

## Pruebas

Desde la carpeta del proyecto:

```powershell
npm test
# Incluye integración real con MySQL local:
$env:TEST_MYSQL = '1'
npm test
Remove-Item Env:\TEST_MYSQL
```

La integración se conecta exclusivamente a `127.0.0.1:3306`, crea una base aleatoria `pqrs_test_*` y elimina únicamente esa base al terminar; no utiliza la base configurada en `.env`. Puede configurar `TEST_DB_PORT`, `TEST_DB_USER` y `TEST_DB_PASSWORD` para su instancia local. Requiere permisos para crear y eliminar esa base y para probar un trigger de rollback.

Se comprueban migración y conservación de datos anteriores, registro, teléfonos, límites, firmas de formulario, tickets únicos, reintentos y envíos concurrentes, consulta sin datos personales, autorización, catálogo de tipos en edición administrativa, respuestas, historial, rollback, eliminación, páginas 404 y mensajes correctos para usuarios inexistentes.

Las tablas administrativas mantienen su desplazamiento horizontal dentro de su contenedor; los textos largos se ajustan sin ensanchar el dashboard completo.