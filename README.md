# 🌍 Planeta Vivo — arena por turnos para 3 IA

Un planeta aleatorio, tres aldeas idénticas y tres plataformas compitiendo en vivo por HTTP.
Vos mirás desde arriba y podés intervenir como dios.

## Arrancar

```powershell
cd "C:\Users\tomas\AppData\Local\Temp\opencode\planeta-vivo"
node server.js
```

- Panel del dios: <http://localhost:7788>
- Las claves de las tres plataformas están en `keys.json` y también se muestran arriba del panel.

No tiene dependencias: solo Node.

## Cómo juega cada IA

Cada plataforma tiene una clave. Con esa clave consulta el estado y manda sus órdenes:

```powershell
# leer el estado
curl.exe -s "http://localhost:7788/api/state?key=clv-xxxxxxxx"

# mandar órdenes del turno (food, mat, build, explore, rest; la suma <= población)
curl.exe -s -X POST "http://localhost:7788/api/orders?key=clv-xxxxxxxx" ^
  -H "Content-Type: application/json" ^
  -d "{\"orders\":{\"food\":4,\"mat\":1,\"build\":1,\"explore\":0,\"rest\":0},\"note\":\"plan de crecimiento\"}"

# también por query string, sin body
curl.exe -s "http://localhost:7788/api/orders?key=clv-xxxxxxxx&food=4&mat=1&build=1&explore=0&rest=0"

# reglas en texto plano
curl.exe -s "http://localhost:7788/api/rules"
```

El turno se resuelve solo cuando las tres mandaron (o cuando vence el reloj: 90 s, y el que no
mandó juega con el bot de respaldo). También podés forzarlo desde el panel con **resolver turno**.

El archivo `prompt-para-ia.md` tiene el texto para pegarle a Claude, Codex y OpenCode.

## Qué ve el dios

- **Mapa gigante con zoom y arrastre**: el planeta mide 12000×8000 px de mundo
  (grid 120×80 casilleros) y arranca viendo el planeta entero a todo el ancho.
  - **Rueda** = zoom hacia donde apuntás (hasta ~780 % del plano, el tope lo fija la memoria del terreno cacheado), **arrastrar** = mover, botones `−  100%  +  ⤢`
    (⤢ vuelve a ver el planeta entero), doble clic = acercar.
  - El minimapa (esquina derecha) muestra el planeta con el recorrido del cámara; **clic**
    viaja a esa zona y acerca si estaba en vista de planeta.
  - El terreno es orgánico: los biomas se dibujan con bordes ondulados y colores mezclados,
    sin rejilla ni cuadritos, y el agua tiene oleaje y la costa arena.
    El mar es un mar: solo se ve en las costas más cercanas a la orilla.
  - Los tres asentamientos arrancan muy lejos entre sí (distancias de 35–100 casilleros).
  - Los números de cada casillero son el rinde: <span>verde = comida</span>, <span>ocre = materiales</span>
    (aparecen al acercar el zoom y se apagan con el checkbox **rindes**).
  - Los peligros son halos rojos que laten; las vetas, rombos dorados.
  - Las **personitas** se dibujan con cuerpo y cabeza, y un punto del color de su tarea (verde cosechar, ocre extraer, naranja construir, celeste explorar, gris descansar).
  - Pasando el mouse por arriba aparece el detalle del casillero; con un clic lo apuntás para un poder divino (aro amarillo).
- **Tarjetas** de cada plataforma: población, comida, materiales, refugios, ciencia, ánimo, puntaje,
  si está conectada, si ya mandó las órdenes y qué pasó en su último turno.
- **Poderes divinos** (energía ✨ que sube 1 por turno, máximo 10):
  - por facción: lluvia fértil, bendición, plaga, terremoto
  - por casillero: meteorito, veta oculta, fertilidad
- **Crónica** de todo lo que pasa, con los eventos, las muertes y tus intervenciones.

## Reglas (resumen)

Puntaje final = población×12 + refugios útiles×8 + √comida×6 + √materiales×7 + ciencia×1.6.

- Arranque idéntico: 6 personas, 16 comida, 4 materiales, 0 refugios, ánimo 70 (en un mapa de 120×80 casilleros con los asentamientos muy lejos entre sí).
- Cada persona come 1 + 3% de hacinamiento (pop 20 → 1.6 cada una).
- Tareas: cosechar, extraer, construir (2 materiales por persona, 3 de obra = 1 refugio), explorar (+ciencia y vetas), descansar (+ánimo).
- Un refugio aloja 4 personas; sin lugar no hay nacimientos.
- Peligros del terreno: 9–13% de muerte por turno al trabajar ahí, y rinden menos.
- Eventos: uno personal por facción por turno, del mismo mazo (reparto parejo), y a veces uno global para todos.
- Resolución simultánea: el orden en que mandan las órdenes no da ninguna ventaja.
- El planeta se genera buscando tres regiones de potencial casi igual: el panel muestra el **índice de paridad**.

## Archivos

| archivo | qué es |
|---|---|
| `server.js` | servidor HTTP, API, reloj de turnos y claves |
| `engine.js` | generación del planeta, reglas, IA de respaldo y poderes |
| `public/` | panel del dios (HTML/CSS/JS, sin build) |
| `keys.json` | claves de las tres plataformas (se genera sola) |
| `prompt-para-ia.md` | texto para pegar en cada IA |

## Notas

- El servidor escucha en `0.0.0.0`, así que también se puede jugar desde otra máquina de la red.
- Un planeta nuevo se crea desde el panel (semilla) o con `POST /api/new`.
- Los bots de respaldo se pueden apagar en el panel si querés esperar a las tres IA sin límite.

