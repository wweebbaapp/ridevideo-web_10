# RideVideo Web — versione 10

Versione **web app (PWA)** di RideVideo, per usarla su **tablet Android**
(Samsung Galaxy Tab S9) e su qualsiasi dispositivo con un browser moderno
(Chrome, Edge, Safari).

A differenza della versione desktop Python, questa gira **nel browser**:
- Sincronizzazione video ↔ traccia GPS
- HUD sopra il video (velocità, watt, cadenza, distanza, dislivello, pendenza, calorie, tempo)
- Grafico potenza + **zoom altimetrico dettagliato**
- Fisica realistica
- **Trainer BLE** via Web Bluetooth (Chrome)

**Tutto locale: nessun account, nessun multiplayer.** Le mappe e il nome del
paese richiedono una connessione internet; il resto funziona offline.

---

## Novità della versione 10 (rispetto alla 9)

Modifiche limitate alla scheda **⏱ Intervalli**:

1. **Numeri leggibili dalla bici** — subito sotto il profilo dell'allenamento
   ci sono quattro riquadri grandi con potenza reale, watt richiesti in quel
   momento, RPM reali e pendenza reale. Sotto ogni numero ci sono target e
   scostamento dalla potenza impostata.
2. **Zoom del profilo nella colonna di destra** — durante gli intervalli lo
   spazio usato di solito dall'altimetria GPX mostra ora un ingrandimento del
   profilo: barre/target colorati per fase, linea della potenza reale, soglia
   FTP e indicatore della posizione attuale.
3. **La casella “Altimetria ±” comanda lo zoom** — in modalità intervalli
   diventa “Zoom profilo ±” e il valore è interpretato in secondi (default
   **50**, cioè ±50 s); lo stesso valore resta in metri per i GPX.
4. **A− / A+ funzionano davvero negli intervalli** — oltre ai testi, vengono
   ricalcolati e ridisegnati i canvas del profilo e dello zoom.
5. **Profilo centrale più grande** — il grafico degli intervalli occupa quasi
   tutta l'altezza della finestra video: rimossi i piccoli riquadri ripetuti in
   alto e il grafico della pendenza sotto il video, che non era leggibile.

### Novità della versione 9 (rispetto alla 8)

1. **A+ / A− ingrandiscono tutta l'interfaccia** — non più solo l'HUD sopra il
   video: crescono anche i watt del grafico in alto a destra, il target sotto
   il riquadro principale, timer, pulsanti, etichette e scritte dei grafici.
   La scelta (80% … 220%) resta salvata nel browser.
2. **Watt, RPM e pendenza sempre visibili negli intervalli** — tre riquadri
   dedicati mostrano `target → attuale` per potenza, cadenza e pendenza. Con
   trainer BLE la pendenza "attuale" è stimata da potenza e velocità, quindi
   puoi verificare che ripetute e recuperi avvengano davvero alle pendenze
   impostate.
3. **Grafico della pendenza negli intervalli** — la striscia dell'altimetria
   (inutile senza GPX) diventa un grafico a gradini con la pendenza prevista
   per ogni fase (colorata per fascia) e la curva della pendenza reale.
4. **Profilo degli intervalli proporzionale alle %FTP** — le barre sono alte
   in base alla percentuale di FTP impostata (90% e 80% ora sono quasi
   uguali); una linea tratteggiata sottile segna la soglia 100% FTP con il
   valore in watt.
5. **Curva di potenza reale + avvisi discreti** — sullo stesso grafico viene
   disegnata la potenza effettiva pedalata; se per ~1,5 s sei oltre il ±12%
   del target oppure fuori dal range RPM, appare un piccolo avviso non
   invasivo in alto a destra.
6. **Test FTP preimpostato** — quarto preset accanto a 30 min / 1 ora / 1h 30
   (anche pulsante `🔥 Test FTP` nella schermata intervalli): 10' riscaldamento,
   5' preparazione, 20' al 95% FTP su pendenza +2%, 5' defaticamento. A fine
   test viene mostrata la potenza media dei 20' e l'FTP stimato (×0,95), con
   un pulsante per impostarlo direttamente.

### Novità della versione 8 (rispetto alla 7)

1. **Paese/località attraversata sempre visibile** — un badge nella barra in
   alto mostra il nome del paese o della città (es. Roma, Foggia, Alberona,
   Biccari); un'etichetta discreta nell'angolo della mappa ripete il nome,
   aggiornato automaticamente mentre avanzi. La ricerca inversa è leggera, con
   cache e limite di frequenza (BigDataCloud, fallback Nominatim).
2. **Zoom della mappa libero** — la telecamera non forza più lo zoom: puoi
   usare rotellina/pizzico oppure i pulsanti `+` / `−` e mantenere il livello
   scelto. Trascinando o ruotando la mappa il "segui" si mette in pausa; il
   pulsante `🎯 Segui / Recentra` lo riattiva.
3. **Colori della pendenza coerenti** — un'unica tabella di fasce di pendenza
   per altimetria completa, zoom altimetrico e pallino. Il colore della curva
   nello zoom viene calcolato dalla pendenza della linea effettivamente
   disegnata, quindi a parità di pendenza visiva corrisponde sempre lo stesso
   colore (e viceversa). Il pallino mostra anche il valore numerico
   (`metri · +x.x%`) per verificare la corrispondenza.
4. **Legenda discreta** — la scala colori non è più un gradiente continuo ma
   blocchi separati, uno per fascia di pendenza.

### Novità della versione 7 (rispetto alla 6)

1. **Video senza barra colorata laterale** — i video con parte colorata a
   destra (es. Norvegia/Madagascar) vengono ritagliati alla porzione 16:9 e
   centrati; la fascia blu resta uniforme su entrambi i lati.
2. **HUD sinistro in un unico riquadro** — velocità, potenza, cadenza, km
   percorsi e km rimanenti stanno in una sola colonna, senza riquadri separati
   e senza valori che escono dal bordo.
3. **Dislivello più leggibile** — valore e unità separati, ad esempio
   `116 m / 136 m` invece di `116m/136m`.
4. **Grafico di destra di nuovo come zoom dell'altimetria** — asse verticale
   in metri e salite/discese in dettaglio; niente più percentuale di pendenza
   né valori negativi.
5. **Zoom altimetrico regolabile e spostamento nel percorso** — zoom iniziale
   ±50 m, campo `Vai a km` per saltare in un punto qualsiasi e trascinamento
   del pallino sull'altimetria (o sulla barra del percorso) per spostarsi.

### Funzioni introdotte nella versione 6

1. **Dislivello fatto / previsto** — l'HUD mostra ad esempio `150m/750m`.
2. **Calorie bruciate** — valore stimato in kcal, in basso a destra sopra il
   tempo di allenamento.
3. **Sfondo video blu** — le bande laterali del video sono dello stesso blu
   dell'interfaccia.
4. **Grafico di destra più grande** (nella v7 torna a essere uno zoom
   dell'altimetria).
5. **Pendenza massima 20%** — limite al trainer e indicatore `(max)`.

### Funzioni già presenti dalla versione 5

- **Mappa 3D** con rilievo quando carichi solo il GPX; il pallino segue la
  traccia e la telecamera accompagna il ciclista.
- **Nessun account Cesium ion**: MapLibre GL JS incluso, OpenStreetMap e
  AWS Terrain Tiles.
- **Passaggio Video / Mappa 3D** senza ricaricare nulla.
- **Attribuzione mappa** OpenStreetMap / AWS Open Data.
- **Pendenza sempre visibile in alto** nell'HUD, anche con testo ingrandito.
- **Schermo sempre acceso** durante la pedalata (Screen Wake Lock).
- **Testo dell'HUD regolabile** con **A+ / A−** (80% … 220%, scelta salvata).
- **HUD con più informazioni**: km percorsi, km rimanenti, dislivello, calorie e tempo.

---

## Contenuto della cartella

```
ridevideo-web_10/
├── index.html              pagina principale
├── styles.css              stile
├── manifest.webmanifest    per installare l'app
├── sw.js                   service worker (funziona offline)
├── avvia-server.command    avvia server + browser (Mac, porta 8018)
├── run.sh                  avvia il server su Termux (porta 8018)
├── install-autostart.sh    rende automatico l'avvio aprendo Termux
├── stop-server.sh          ferma il server
├── setup-termux.sh         installazione su un tablet nuovo
├── setup-v10-termux.sh     setup completo (autostart + riavvio server)
├── js/
│   ├── app.js              logica principale
│   ├── physics.js          modello fisico
│   ├── gpx.js              parser GPX
│   ├── video-sync.js       sincronizzazione video↔GPS
│   ├── map-view.js         mappa 3D di fallback (MapLibre)
│   ├── geocode.js          paese/città attraversati (ricerca inversa)
│   ├── trainer.js          trainer BLE (FTMS)
│   ├── hud.js              HUD sovrapposto (testo regolabile)
│   ├── ui-scale.js         scala del testo condivisa da DOM e canvas
│   ├── charts.js           grafico potenza
│   ├── elevation.js        altimetria del percorso + palette pendenza
│   ├── slope-chart.js      profilo dettagliato della pendenza
│   ├── intervals.js        modello allenamenti + preset (anche test FTP)
│   ├── interval-view.js    grafico intervalli, potenza reale e avvisi
│   └── interval-zoom-chart.js   zoom del profilo potenza negli intervalli
└── vendor/maplibre/        MapLibre GL JS incluso (nessun token)
```

> La versione **1** sta in `ridevideo-web/` (porta 8000), la **2** in
> `ridevideo-web_2/` (porta 8010), la **3** in `ridevideo-web_3/` (porta
> 8011), la **4** in `ridevideo-web_4/` (porta 8012), la **5** in
> `ridevideo-web_5/` (porta 8013), la **6** in `ridevideo-web_6/` (porta
> 8014), la **7** in `ridevideo-web_7/` (porta 8015), la **8** in
> `ridevideo-web_8/` (porta 8016), la **9** in `ridevideo-web_9/` (porta
> 8017), questa in **`ridevideo-web_10/` (porta 8018)**: possono girare
> contemporaneamente.

---

## Testo più grande o più piccolo (tutta l'interfaccia)

I pulsanti **A+ / A−** sono in alto a destra, accanto al nome del percorso:

- ogni click cambia la dimensione di **tutte** le scritte dell'interfaccia del 5%
  (HUD, watt del grafico, target, timer, pulsanti, etichette e grafici);
- nella scheda intervalli aggiorna anche i riquadri grandi e i tre canvas
  (profilo, pendenza e zoom), senza bisogno di ridimensionare la finestra;
- scala consentita: **80% … 220%** (default 125%);
- la dimensione scelta viene salvata nel browser, quindi riaprendo la app
  il testo resta quello che preferisci;
- se sullo schermo non c'è spazio, l'HUD ridimensiona automaticamente i
  riquadri (e, se serve, le righe secondarie) senza sovrapporsi.

---

## Mappa 3D senza video

Se non hai il filmato del percorso:

1. carica il **GPX**;
2. la mappa 3D si apre da sola, inquadrando tutto il tracciato;
3. premi **Play**: il pallino blu avanza lungo la traccia e la telecamera lo
   segue, con il rilievo del terreno.

La mappa usa:

- **MapLibre GL JS** incluso in `vendor/maplibre/` (gratuito, nessun account);
- tessere **OpenStreetMap** per la cartografia;
- **AWS Terrain Tiles** per il rilievo 3D.

Quindi **non serve Cesium ion** e non serve alcun token. Serve però una
connessione internet mentre si pedala, perché le tessere della mappa vengono
scaricate online. Il video, il GPX e i dati dell'allenamento restano sempre
sul dispositivo.

Se carichi anche un video, puoi passare dalla mappa al video con il pulsante
**🗺 Mappa 3D / 🎬 Video**.

---

## Altimetria

Sotto il riquadro del video c'è il **profilo altimetrico completo del percorso**
(dal km 0 alla fine), con:

- un **pallino** che segue la posizione in tempo reale (altezza = quota,
  orizzontale = chilometro);
- un'**etichetta** con la quota accanto al pallino e, in alto a destra,
  i chilometri percorsi / totali;
- i segmenti **colorati in base alla pendenza**:

| Colore | Categoria | Pendenza |
|---|---|---|
| 🔵 blu | Discesa | < -1,5% |
| 🟢 verde | Pianura | -1,5% … +1,5% |
| 🟡 giallo | Salita lieve | 1,5% … 4% |
| 🟠 ambra | Salita media | 4% … 7% |
| 🟠 arancio | Salita importante | 7% … 10% |
| 🔴 rosso | Salita strong | ≥ 10% |

Le soglie sono definite in `js/elevation.js` (array `CATEGORIES`): basta
modificare il campo `max` per ricalibrarle.

Il **grafico della pendenza** a destra mostra un profilo dettagliato intorno
alla posizione attuale: barre colorate con la palette `SLOPE_BANDS` (blu per
le discese, giallo → arancio → rosso per le salite), griglia percentuale,
finestra mobile di ±1,5 km e indicatore della pendenza corrente. Oltre il
+20% il valore viene limitato e marcato con `(max)`.

---

## Uso rapido su Mac (per provarla subito)

1. Doppio clic su **`avvia-server.command`**
2. Si apre il browser su `http://localhost:8018`
3. Clicca **"Carica GPX"** e scegli un file `.gpx`
4. Se hai il video, clicca **"Carica Video"**; altrimenti resta la mappa 3D
5. Premi **Play**

---

## Tablet Samsung (con trainer BLE)

Sul tablet (Galaxy Tab, `SM_X210`):

- copia la cartella in `/sdcard/Download/ridevideo-web_10/`
- server Python (porta **8018**) su **Termux**, con **avvio automatico**
  ogni volta che apri Termux (`bash install-autostart.sh`)
- log del server: `/sdcard/Download/ridevideo10-server.log`

### Uso quotidiano

1. Apri **Termux** → il server parte da solo (riga "App pronta")
2. Apri **Chrome** e vai su **`http://localhost:8018`**
3. Menu **⋮** → **"Aggiungi a schermata Home"** (una volta sola)
4. Carica il GPX (il video è opzionale) e premi Play

Le versioni 2 (8010), 3 (8011), 4 (8012), 5 (8013), 6 (8014), 7 (8015),
8 (8016) e 9 (8017) possono restare installate: le app non si disturbano,
ma ricorda di aprire quella giusta (`8018` = versione 10).

### Ferma / riavvia il server

- **Ferma**: in Termux → `bash /sdcard/Download/ridevideo-web_10/stop-server.sh`
  (oppure `pkill -f "http.server 8018"`)
- **Riapri Termux** e il server torna su da solo

### Installazione su un altro tablet (o da capo)

```bash
cd /sdcard/Download/ridevideo-web_10
bash setup-termux.sh          # scarica python e prepara Termux
bash setup-v10-termux.sh      # setup completo + autostart + self-check
bash install-autostart.sh     # avvio automatico all'apertura di Termux
bash run.sh                   # primo avvio immediato
```

La web app va aperta da `http://localhost` perché Chrome abiliti
**Bluetooth**: lo consente solo su "contesti sicuri" (localhost o https).

---

## Perché serve un server locale (non si può aprire index.html da file://)

L'app usa **moduli ES** (`import`), che Chrome blocca su `file://`
(errori CORS), e **Web Bluetooth**, che richiede un contesto sicuro.
Il server di Termux (`python -m http.server 8018`) risolve entrambi i
problemi: tutto resta sul tablet, senza internet.

---

## Note

- I video non vengono mai caricati su internet: restano sul dispositivo.
- La app funziona anche offline dopo la prima apertura (service worker).
- Per usare file locali su Android, il selettore file di Chrome ti farà
  scegliere gli elementi dal tablet.
- Se l'app serve una versione vecchia dal cache: ricarica la pagina con
  "Aggiorna" (pull-to-refresh) oppure apri le DevTools → Application →
  Clear site data.
