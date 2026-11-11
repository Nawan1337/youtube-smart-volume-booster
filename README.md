# 🎵 YouTube Smart Volume Booster & Auto-Leveler

Extension Google Chrome (Manifest V3) sur mesure conçue pour résoudre le problème des disparités de volume entre les vidéos et musiques sur **YouTube** et **YouTube Music**.

---

## 🎯 Le problème résolu

Sur YouTube, certaines vidéos sont enregistrées ou mixées à un volume sonore anormalement bas :
- Si vous montez votre amplificateur externe pour entendre ce morceau faible, le morceau suivant dans la playlist (enregistré à un volume standard) va hurler et saturer vos enceintes.
- Un simple "booster" fixe (comme proposé dans certains tutoriels) ne fait que multiplier le son de tout le monde par 2, ce qui fait exploser les morceaux déjà normaux.

### ✨ Comment cette extension règle le problème :
1. **Égalisation dynamique automatique (AGC - Automatic Gain Control) :**
   - Analyse le niveau sonore réel (RMS) en temps réel via la **Web Audio API**.
   - Si la vidéo est faible, le son est **progressivement et automatiquement amplifié** (jusqu'à x3.0 ou x5.0 selon votre réglage).
   - Dès qu'une vidéo standard ou forte arrive, le gain revient immédiatement à **x1.0** (aucun boost).
2. **Double protection anti-saturation (Compresseur dynamique + Brickwall Limiter) :**
   - Plafonne instantanément les pics audio imprévus (coups de cymbale, explosions, passages d'une vidéo faible à forte).
   - Vos oreilles et votre amplificateur ne saturent **jamais**.
3. **Compatible YouTube & YouTube Music (SPA) :**
   - Détecte automatiquement les changements de morceaux dans les playlists sans recharger la page (`yt-navigate-finish`).
   - Réinitialise le gain au démarrage d'une nouvelle piste pour éviter tout coup de son brutal.
4. **Interface Popup avec VU-Mètre en temps réel :**
   - Affiche le niveau audio en direct et le multiplicateur de gain appliqué (`x2.4 (+7.6 dB)`).

---

## 🚀 Installation dans Google Chrome (en 30 secondes)

1. Ouvrez Google Chrome et accédez à :
   ```text
   chrome://extensions/
   ```
2. En haut à droite, activez l'interrupteur **« Mode développeur »**.
3. Cliquez en haut à gauche sur le bouton **« Charger l'extension non emballée »** (ou *Load unpacked*).
4. Sélectionnez le dossier décompressé :
   `youtube-smart-volume-booster`
5. L'extension est installée ! Son icône apparaît dans votre barre d'extensions Chrome (vous pouvez l'épingler).

---

## 🎛️ Utilisation

1. Ouvrez une vidéo ou une playlist sur [YouTube](https://www.youtube.com) ou [YouTube Music](https://music.youtube.com).
2. Cliquez sur l'icône de l'extension :
   - Le statut passe à **« Audio actif »** (point vert).
   - Le VU-mètre bouge au rythme de la musique.
   - Si le morceau est bas, vous verrez le badge de gain s'allumer en jaune : par exemple `x2.6 (+8.3 dB)` indiquant que l'extension rattrape le manque de volume en temps réel.
3. Vous pouvez choisir entre :
   - **Mode Auto Égaliseur (Conseillé) :** Laisse l'algorithme doser le boost uniquement sur les pistes faibles.
   - **Mode Manuel Fixe :** Pour appliquer une amplification fixe personnalisée.
