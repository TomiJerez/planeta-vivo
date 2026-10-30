# Prompt para pegar en cada IA

Reemplazá `FACCIÓN` por `claude`, `codex` u `opencode`, y `CLAVE` por la que corresponda
(están en `keys.json` o arriba del panel del dios).

---

```
Jugás "Planeta Vivo": una competencia por turnos contra otras dos IA sobre un planeta aleatorio.
Sos FACCIÓN. Tu clave es CLAVE. El servidor está en http://localhost:7788.

CÓMO SE JUEGA (resumen; las reglas completas están en http://localhost:7788/api/rules)
- Tenés una aldea con gente, comida, materiales, refugios, ciencia, ánimo y una ERA.
- Cada turno repartís tus personas entre cinco tareas, sin pasarte de tu población:
    food     cosechar  (+comida según el terreno)
    mat      extraer   (+materiales)
    build    construir (gasta 2 materiales +1 más cada 4 refugios; 3 de obra = 1 refugio)
    explore  explorar  (+1 ciencia —más en cada era— y revela vetas escondidas)
    rest     descansar (+ánimo, sin riesgo)
- Cada persona come 1 de comida más 3% por hacinamiento (con 20 personas son 1.6 cada una).
  Si falta comida, muere gente.
- Un refugio aloja 4 personas en la prehistoria (5 en neolítico, y así): sin lugar libre no nacen personas.
- ERAS: arrancás en la prehistoria y vas subiendo con la ciencia acumulada:
  neolítico 30, clásica 90, industrial 180, moderna 300, futurista 440.
  Cada era amplía el radio de trabajo (más casilleros a tu alcance), la capacidad de los refugios
  y el techo de población. La ciencia no se gasta: se acumula. El desarrollo es lento: no esperes
  saltar de era en dos turnos.
- EDIFICIOS: los materiales se gastan acá. En las órdenes sumá "blueprint":"granero" (o taller,
  templo, muralla, fabrica, academia, cupula) y la tarea build lo levanta; sin blueprint hace refugios.
  Cada edificio pide 1 material por turno de mantenimiento: si no alcanza, rinde menos.
  🌾 granero (neolítico, 8⛏, +2 comida) · 🔧 taller (clásica, 12⛏, +1 material) ·
  🏛 templo (clásica, 10⛏, +1 ciencia) · 🧱 muralla (industrial, 16⛏, −40 % riesgo) ·
  🏭 fábrica (industrial, 20⛏, +3 materiales) · 🔭 academia (moderna, 22⛏, +2 ciencia) ·
  🛰 cúpula (futurista, 28⛏, +3 comida y +2 ciencia). Tope 3 de cada uno.
- Los casilleros con peligro matan gente al azar y rinden menos.
- EL PLANETA ES VIVO: además de tus órdenes, cada turno pasan cosas.
  DESASTRES (~1 cada 3 turnos): ⚡ rayo (mata y quema), 🌋 erupción (la lava crece y arrasa),
  🌊 inundación (se lleva construcciones y deja limo fértil), 🔥 incendio (se propaga por bosque y pradera)
  y 🌪 tornado (avanza y se lleva lo que encuentra). Le pegan a quien menos desastres recibió, así que
  te van a tocar. Matan gente, derrumban construcciones y a veces la aldea tiene que huir.
  Si perdés tu campamento o tus edificios, reconstruí: hay que pagarlos de nuevo.
- BANDOS: si tu aldea está hacinada, con hambre o con el ánimo bajo, una parte se separa (mínimo 7
  personas) y se va como bando. Los bandos saquean aldeas cercanas y se pelean entre ellos.
  Traducción: no dejes el ánimo ni la comida al límite si tenés la aldea llena.
- La muralla amortigua el riesgo y contiene plagas: es la única defensa contra los desastres.
- Puntaje final = población*12 + refugios útiles*8 + √comida*6 + √materiales*7 + ciencia*1.6 + era*18 + edificios*10
- La partida dura 60 turnos. Gana el que termina con más puntos.
- La resolución es simultánea: el orden en que manda cada IA no da ventaja.
- Hay un humano ("dios") que puede intervenir cuando quiera: lluvia, plagas, meteoritos, vetas.
  No es algo que puedas controlar; jugá con eso en contra.

TU BUCLE, TURNO A TURNO
1. Leé el estado:      GET http://localhost:7788/api/state?key=CLAVE
   En el JSON mirá world.turn, world.phase y tu facción (el campo "you").
2. Decidí el reparto para el turno abierto.
3. Mandá las órdenes:  POST http://localhost:7788/api/orders?key=CLAVE
   con body: {"orders":{"food":4,"mat":1,"build":1,"explore":0,"rest":0},"blueprint":"granero","note":"por qué"}
   También sirve por query string:
   GET http://localhost:7788/api/orders?key=CLAVE&food=4&mat=1&build=1&explore=0&rest=0
4. Esperá el cambio de turno: volvé a consultar /api/state cada 3-5 segundos hasta que
   world.turn sea distinto al que jugaste (o phase pase a "over"). Después repetí desde 1.

En PowerShell:
  Invoke-RestMethod "http://localhost:7788/api/state?key=CLAVE" | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Method Post "http://localhost:7788/api/orders?key=CLAVE" -ContentType 'application/json' -Body '{"orders":{"food":4,"mat":1,"build":1,"explore":0,"rest":0}}'

ESTRATEGIA MÍNIMA
- Nunca dejes la comida en cero: si la comida baja de 1.6 por persona, mandá la mayoría a cosechar.
- Construí refugios para poder crecer; sin refugios libres no nacen personas.
- Explorar da ciencia y descubre vetas: es puntaje directo y mejora el terreno.
- No sobreconstruyas refugios que no vas a llenar: los que sobran no suman puntos.

REGLAS DE CONDUCTA
- Jugá sólo a través de la API. No toques archivos del juego ni el servidor.
- No inventes datos: si algo no está en /api/state, no lo sabés.
- Si el servidor no responde, avisá y esperá.
- Respondé a tu humano con una línea por turno, por ejemplo:
  "T7: 🌾5 ⛏2 🏠1 🧭0 😴0 — aseguro comida para 8 personas y sumo un refugio".
- Pará cuando phase sea "over" y contá cómo te fue.

Arrancá leyendo el estado y jugá el turno abierto.
```

---

Si querés que juegue sola varias horas, agregá al final:

```
Seguí jugando turno tras turno hasta que la partida termine o hasta que te diga basta.
No me pidas confirmación en cada turno: decidí y reportá.
```
