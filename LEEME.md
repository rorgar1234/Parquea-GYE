# Parquea GYE — primer prototipo

Esta primera etapa es una app web para explorar espacios de parqueo de ejemplo en Guayaquil y crear/cancelar reservas de demostración. Incluye registro e inicio de sesión. Los parqueos, cuentas y reservas se guardan en una base de datos SQLite local, dentro del archivo `data/parquea-gye.sqlite`.

## Abrir y ejecutar en Windows

1. En Visual Studio Code Insiders, ve a **File → Open Folder** y abre la carpeta del proyecto.
2. Abre **Terminal → New Terminal**.
3. En la terminal ejecuta:

   ```powershell
   npm.cmd run dev
   ```

4. Deja esa terminal abierta. Abre el navegador y visita **http://localhost:3000**.
5. Para detener la app, vuelve a la terminal y presiona **Ctrl + C**.

## Lo que incluye esta etapa

- Búsqueda por zonas de Guayaquil y tipo de vehículo.
- Seis parqueos de demostración con precios y servicios de ejemplo.
- Creación, consulta y cancelación de reservas.
- Las reservas canceladas dejan de aparecer en la lista de reservas activas; se conserva su registro para el aviso de cancelación.
- En la tarjeta de registro, la insignia «P» se puede arrastrar para hacerla rebotar; también se mueve con las flechas del teclado.
- Base SQLite local: los datos permanecen guardados después de cerrar la app, pero solo están disponibles en esta computadora.
- Registro con correo obligatorio, teléfono opcional y contraseña; las reservas se asocian a la cuenta que inició sesión.
- Recuperación de contraseña por correo: el enlace de un solo uso vence en 30 minutos, abre la pantalla local para cambiar la clave y cierra las sesiones anteriores.
- El correo debe ser único; puedes repetir el nombre de usuario. Si hay usuarios repetidos y la contraseña no distingue una sola cuenta, inicia sesión con el correo.
- Roles de acceso: `rogers1234800@gmail.com` es siempre la cuenta administradora; las demás cuentas empiezan como clientes. En el panel de administración se muestran todas las personas y puedes asignarles el rol de moderador. Administración edita parqueos y revisa toda la actividad; moderación consulta el panel de reservas.
- La página de restablecimiento permite mostrar u ocultar la contraseña nueva y su confirmación.
- Usuario de acceso con 3 a 20 letras o números, sin símbolos. La contraseña se puede mostrar u ocultar en registro e inicio de sesión.
- Video insertado del Malecón 2000, en el centro de Guayaquil; toca la portada para reproducirlo y requiere conexión a internet.
- Al reservar, la app intenta enviar los detalles al correo registrado. Al cancelar, conserva la reserva como cancelada e intenta enviar un correo de confirmación de cancelación.
- Al crear una cuenta, envía un correo de bienvenida con el estilo de Parquea-GYE e informa en pantalla si el envío se realizó.
- El correo incluye el logotipo y los datos del negocio Parquea GYE.

## Configurar notificaciones reales

El código ya tiene las conexiones preparadas. Para que se envíen mensajes se necesitan credenciales propias:

1. Copia `.env.example` y crea un archivo llamado `.env` en esta carpeta.
2. Completa la clave API de Resend y un remitente permitido para el correo.
3. Reinicia el servidor con `Ctrl + C` y `npm.cmd run dev`.

No compartas las claves del archivo `.env` por el chat. El correo de bienvenida, la recuperación de contraseña, las reservas y las cancelaciones se envían mediante la [API de Resend](https://resend.com/docs/api-reference/emails/send-email). El registro actualmente solo solicita correo; el campo de teléfono y los avisos de WhatsApp están pausados. Como la app es local, abre el enlace de recuperación en la misma computadora donde corre `http://localhost:3000`.

El flujo de pago ficticio se agregará después, sin cobrar dinero real. Más adelante podemos publicar la app y mover la base de datos a un servicio en línea.
