# 🌍 Planeta Vivo — arena por turnos para 3 IA

Un planeta gigante, tres aldeas idénticas y tres plataformas compitiendo en vivo por HTTP.
La partida va de una **civilización prehistórica a una futurista**, despacio: 60 turnos y seis eras.
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

- **Mapa gigante con zoom y arrastre**: el planeta mide 24000×16000 px de mundo
  (grid 240×160 casilleros, 38.400 casilleros) y arranca viendo el planeta entero a todo el ancho.
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

Puntaje final = población×12 + refugios útiles×8 + √comida×6 + √materiales×7 + ciencia×1.6 + era×18 + edificios×10.

- **Eras** (desarrollo lento, se pagan con ciencia acumulada — no se gasta):
  | era | ciencia | radio de trabajo | refugio aloja | techo de población |
  |---|---|---|---|---|
  | 🪨 prehistoria | 0 | 5,6 | 4 | 20 |
  | 🌾 neolítico | 30 | 7,0 | 5 | 26 |
  | 🏛 clásica | 90 | 8,5 | 6 | 34 |
  | ⚙️ industrial | 180 | 10,0 | 7 | 44 |
  | 🔌 moderna | 300 | 12,5 | 8 | 56 |
  | 🚀 futurista | 440 | 15,0 | 10 | 72 |

  Cada era amplía el **radio de trabajo** (más casilleros a mano = más espacio para crecer),
  la capacidad de los refugios y el techo de población. Los rindes del terreno **no** suben:
  el progreso es territorial, no inflacionario. La tarjeta de cada facción muestra la era y
  cuánta ciencia falta para la siguiente.
- Arranque idéntico: 6 personas, 16 comida, 4 materiales, 0 refugios, ánimo 70 (en un mapa de
  240×160 casilleros con los asentamientos muy lejos entre sí).
- Cada persona come 1 + 3% de hacinamiento (pop 20 → 1.6 cada una).
- Tareas: cosechar, extraer, construir (2 materiales + 1 más cada 4 refugios; 3 de obra = 1 refugio),
  explorar (+ciencia y vetas), descansar (+ánimo).
- **Edificios**: la salida de los materiales. Se piden en las órdenes con `blueprint`
  (`"blueprint":"granero"`); sin blueprint, construir sigue haciendo refugios.
  Cada copia cuesta 60 % más materiales y el tope son 3 por tipo (21 en total).

  | edificio | era | costo | obra | efecto |
  |---|---|---|---|---|
  | 🌾 granero | neolítico | 8 ⛏ | 6 | +2 comida/turno |
  | 🔧 taller | clásica | 12 ⛏ | 8 | +1 material/turno |
  | 🏛 templo | clásica | 10 ⛏ | 8 | +1 ciencia/turno |
  | 🧱 muralla | industrial | 16 ⛏ | 10 | −40 % riesgo del terreno y plagas contenidas |
  | 🏭 fábrica | industrial | 20 ⛏ | 12 | +3 materiales/turno |
  | 🔭 academia | moderna | 22 ⛏ | 14 | +2 ciencia/turno |
  | 🛰 cúpula | futurista | 28 ⛏ | 18 | +3 comida y +2 ciencia/turno |

  **Mantenimiento**: cada edificio consume 1 material por turno; si no alcanza, sus efectos
  rinden en proporción. Por eso conviene tener extracción sostenida y no acopiar de gusto.
- Nacimientos: sólo si sobra comida, hay lugar en los refugios y no llegaste al techo de la era;
  cuestan cada vez más comida (3 + 0,35 × población), así el crecimiento es lento.
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
| `simular.js` | simulador headless: partidas completas con los bots, sin servidor ni IAs conectadas |

## Notas

- El servidor escucha en `0.0.0.0`, así que también se puede jugar desde otra máquina de la red.
- Un planeta nuevo se crea desde el panel (semilla) o con `POST /api/new`.
- Los bots de respaldo se pueden apagar en el panel si querés esperar a las tres IA sin límite.

