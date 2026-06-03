# TOOLBARSPEC

## Objet

Cette spec décrit la **toolbar supérieure** du DAW :

- sa structure en lignes et en zones ;
- l'ordre exact des groupes ;
- les règles de taille, d'alignement et de wrapping ;
- le format à utiliser pour décrire sans ambiguïté une nouvelle variante de toolbar.

Le but est d'éviter les interprétations implicites du type :

- "mettre ça en dessous"
- "plus petit"
- "centré"
- "compact"

qui produisent facilement des layouts incorrects.

---

## Portée

Cette spec concerne uniquement la zone supérieure du DAW contenant notamment :

- le logo ;
- le transport ;
- le timecode ;
- les aides vidéo ;
- le bouton d'aide ;
- les contrôles de session ;
- les boutons de chargement / sauvegarde / export.

Elle ne décrit pas :

- la timeline ;
- les strips de pistes ;
- les panneaux ou overlays ;
- le contenu du footer.

---

## Principes

### P1. Une toolbar est décrite comme un ensemble de **lignes**

Chaque ligne est décrite séparément.

### P2. Chaque ligne est découpée en **trois zones logiques**

- `left`
- `center`
- `right`

Ces zones sont des zones de placement, pas forcément des colonnes rigides.

### P3. Chaque zone contient une **liste ordonnée de groupes**

L'ordre des groupes dans une zone doit être explicitement donné.

### P4. Chaque groupe reçoit une règle de largeur explicite

Les largeurs autorisées sont :

- `fixed(<px>)`
- `intrinsic`
- `flex(min=<px>)`

### P5. Les règles de retour à la ligne doivent être explicites

Pour chaque ligne et/ou groupe, on précise :

- `wrap: never`
- `wrap: allowed`

### P6. Les règles d'alignement doivent être explicites

Pour chaque ligne, on précise :

- alignement global horizontal ;
- alignement vertical ;
- éventuel ancrage par rapport à une autre ligne.

---

## Exigences déjà décidées

À ce stade, les exigences explicitement décidées sont :

### E1. La toolbar supérieure comporte **deux lignes**

- `ligne 1` : transport
- `ligne 2` : session

### E2. Tous les éléments relatifs à la session doivent être sur la **deuxième ligne**

Cela inclut notamment :

- sélecteur de session ;
- nom de session ;
- création de session ;
- ouverture en nouvelle fenêtre ;
- chargement de session ;
- sauvegarde de session ;
- export.

### E3. Les éléments de la deuxième ligne doivent avoir un format **plus compact** que ceux de la première

Concrètement :

- hauteur plus faible ;
- padding plus faible ;
- largeur intrinsèque plus contenue ;
- hiérarchie visuelle moins dominante que le transport.

### E4. La première ligne doit rester la ligne principale

La première ligne porte les éléments les plus saillants de l'interface :

- transport ;
- timecode ;
- éléments tutoriels ;
- aide.

### E5. La seconde ligne ne doit pas casser visuellement la première

En particulier :

- elle ne doit pas pousser le transport dans un layout confus ;
- elle ne doit pas faire remonter ou descendre des éléments de la première ligne ;
- elle doit apparaître comme une ligne secondaire, stable et lisible.

---

## Modèle de description non ambiguë

Toute proposition de toolbar doit être formulée avec le format ci-dessous.

### 1. Structure générale

```text
Ligne 1:
- left:
- center:
- right:

Ligne 2:
- left:
- center:
- right:
```

### 2. Ordre exact des groupes

Chaque zone contient une liste ordonnée.

Exemple :

```text
Ligne 1:
- left: [logo]
- center: [tutorial-left][return][play][timecode][tutorial-right]
- right: [help]

Ligne 2:
- left: []
- center: [session-picker][session-name][new-session][new-window][load][save][export]
- right: []
```

### 3. Règles de largeur

Pour chaque groupe :

```text
logo: fixed(120)
tutorial-left: intrinsic
play: intrinsic
timecode: fixed(160)
session-picker: flex(min=220)
session-name: flex(min=260)
new-session: intrinsic
```

### 4. Règles de hauteur

Pour chaque ligne :

```text
Ligne 1 height: 56
Ligne 2 height: 34
```

ou, si nécessaire, par groupe.

### 5. Règles de wrapping

Exemple :

```text
Ligne 1 wrap: never
Ligne 2 wrap: never
```

ou :

```text
Ligne 2 wrap: allowed
Only session-picker and session-name may shrink before wrapping
```

### 6. Règles d'alignement

Exemple :

```text
Ligne 1:
- left aligned left
- center visually centered in header
- right aligned right

Ligne 2:
- aligned under center zone of line 1
- does not start under the logo
```

### 7. Règles responsive

Exemple :

```text
Desktop:
- two lines mandatory
- line 1 never wraps
- line 2 may compress before wrapping

Narrow screens:
- line 1 may stack vertically
- line 2 remains secondary
```

---

## Wireframe ASCII recommandé

En plus du format structuré ci-dessus, un wireframe ASCII est recommandé.

Exemple :

```text
Ligne 1
[LOGO]            [TUTO-L][RETURN][PLAY][TIMECODE][TUTO-R]            [?]

Ligne 2
                  [SESSION PICKER........][SESSION NAME..........][NEW][WINDOW][LOAD][SAVE][EXPORT]
```

Ce wireframe ne remplace pas la structure formelle ; il la complète.

---

## Vocabulaire recommandé

Pour éviter les ambiguïtés, on utilisera préférentiellement :

- `ligne 1` / `ligne 2`
- `left` / `center` / `right`
- `groupe`
- `fixed` / `intrinsic` / `flex`
- `wrap: never` / `wrap: allowed`
- `aligned under ...`
- `secondary line`
- `visually dominant` / `visually secondary`

On évite autant que possible les formulations vagues :

- "un peu plus petit"
- "vers la gauche"
- "à peu près centré"
- "en dessous"
- "plus propre"

---

## État actuel de décision

Cette spec ne fixe pas encore le layout final exact de la toolbar.

Elle fixe :

- le fait qu'il y aura deux lignes ;
- le fait que la ligne session sera sur la seconde ligne ;
- le fait qu'elle sera plus compacte ;
- et le format à employer pour décrire précisément la version finale.

La prochaine étape consiste à écrire, dans ce format, la **toolbar cible exacte**.

---

## Toolbar commitée de référence

Cette section décrit la toolbar **telle qu'elle était commitée avant l'extension multisessions**.

Il s'agit de la toolbar de référence à partir de laquelle on veut maintenant faire évoluer le layout.

### Structure générale

```text
Ligne 1:
- left: [logo]
- center: [tutorial-left][return][play][timecode][tutorial-right]
- right: [help][load-session][save-session][export-wav]

Ligne 2:
- left: []
- center: []
- right: []
```

### Ordre exact des groupes

```text
Ligne 1:
- left: [logo]
- center: [tutorial-left][transport-return][transport-play][cursor-timecode][tutorial-right]
- right: [shortcuts-help][load-session][save-session][export-wav]

Ligne 2:
- left: []
- center: []
- right: []
```

### Règles de largeur

```text
logo: fixed(120)
tutorial-left: fixed(100)
transport-return: fixed(56)
transport-play: fixed(110)
cursor-timecode: fixed(320)
tutorial-right: fixed(100)
shortcuts-help: fixed(58)
load-session: fixed(132)
save-session: fixed(132)
export-wav: fixed(132)
```

Notes :

- `cursor-timecode` est en pratique borné par `width: min(100%, 320px)` ;
- `tutorial-left` et `tutorial-right` sont des vignettes `16:9` de hauteur `56px`, donc environ `100px` de large ;
- les boutons `load/save/export` partagent le style `transport-export`.

### Règles de hauteur

```text
Ligne 1 height: 56
Ligne 2 height: 0
```

Plus précisément :

- les contrôles de transport utilisent `--toolbar-control-height: 56px` ;
- `shortcuts-help` est circulaire en `58px`;
- `logo` n'est pas contraint par cette hauteur, mais s'inscrit visuellement dans la même ligne.

### Règles de wrapping

```text
Ligne 1 wrap: never
Ligne 2 wrap: n/a
```

Notes :

- le groupe central `session-transport` est en `flex-wrap: nowrap` ;
- la toolbar de référence est donc pensée comme une **toolbar mono-ligne desktop** ;
- sur écrans étroits, le responsive ne conserve pas cette rigidité.

### Règles d'alignement

```text
Ligne 1:
- left aligned left
- center visually centered in header
- right aligned right
- all three zones vertically centered

Ligne 2:
- empty
```

Notes :

- le header desktop est une grille `120px / 1fr / auto` ;
- le logo occupe la colonne gauche ;
- le transport est centré dans la colonne centrale ;
- les actions `help/load/save/export` sont regroupées à droite.

### Règles responsive

```text
Desktop:
- single-line toolbar
- line 1 never wraps
- tutorials visible

Narrow screens:
- header stacks vertically
- tutorials hidden
- action zone expands to full width
- timecode may expand to full width
```

### Wireframe ASCII

```text
Ligne 1
[LOGO]            [TUTO-L][RETURN][PLAY][TIMECODE][TUTO-R]            [?][LOAD][SAVE][EXPORT]

Ligne 2
[]
```

### Statut

Cette toolbar de référence :

- est mono-ligne sur desktop ;
- ne comporte pas encore de groupe de multisessions ;
- sert de baseline visuelle et structurelle pour définir la toolbar cible à deux lignes.

---

## Toolbar cible en cours

Cette section décrit la **toolbar cible actuellement visée** pour l'intégration multisessions.

Elle ne décrit pas l'état historique commitée ; elle décrit la cible de layout en cours de conception.

### Structure générale

```text
Ligne 1:
- left: [logo]
- center: [tutorial-left][return][play][timecode][tutorial-right]
- right: [help][export-wav]

Ligne 2:
- left: []
- center: [session-drag-handle][session-combo]
- right: [save-session][load-session][close-session]
```

### Ordre exact des groupes

```text
Ligne 1:
- left: [logo]
- center: [tutorial-left][transport-return][transport-play][cursor-timecode][tutorial-right]
- right: [shortcuts-help][export-wav]

Ligne 2:
- left: []
- center: [session-drag-handle][session-combo]
- right: [save-session][load-session][close-session]
```

Notes :

- `[session-drag-handle]` est une affordance draggable représentant le rendu audio exportable de la session courante ;
- `[session-combo]` affiche le nom de la session courante ;
- `[session-combo]` permet l'édition inline du nom de la session courante ;
- `[session-combo]` comporte à droite une flèche de menu ;
- ce menu permet de choisir parmi les sessions existantes ;
- ce menu comporte aussi une action `new` pour créer une nouvelle session ;
- `[close-session]` est un bouton texte compact libellé `Close`.

### Règles de largeur

```text
logo: fixed(120)
tutorial-left: fixed(100)
transport-return: fixed(56)
transport-play: fixed(110)
cursor-timecode: fixed(320)
tutorial-right: fixed(100)
shortcuts-help: fixed(58)
export-wav: fixed(132)
session-drag-handle: fixed(34)
session-combo: fixed(360)
save-session: intrinsic
load-session: intrinsic
close-session: intrinsic
```

Notes :

- l'implémentation actuelle borne visuellement `session-combo` entre `320px` et `520px` ;
- le groupe `[session-drag-handle][session-combo]` est centré dans la cellule centrale de la deuxième ligne ;
- le groupe `[save-session][load-session][close-session]` est aligné à droite dans la cellule droite de la deuxième ligne.

### Règles de hauteur

```text
Ligne 1 height: 56
Ligne 2 height: 34
```

Notes :

- la ligne 1 garde la hiérarchie visuelle actuelle ;
- la ligne 2 est visuellement plus compacte ;
- `session-drag-handle`, `session-combo` et les actions de session suivent la hauteur compacte de ligne 2.

### Règles de wrapping

```text
Ligne 1 wrap: never
Ligne 2 wrap: never
```

Notes :

- le groupe transport ne wrap jamais ;
- le groupe session ne wrap jamais en desktop nominal ;
- s'il manque de place, on préfère réduire ou masquer des groupes secondaires plutôt que provoquer un wrap désordonné.

### Règles d'alignement

```text
Ligne 1:
- left aligned left
- center visually centered in header
- right aligned right

Ligne 2:
- aligned under center/right structure of line 1
- does not become visually dominant over line 1
- remains visually secondary
- center cell content is horizontally centered
- right cell content is right-aligned
```

### Politique responsive

Cette toolbar suit une politique **desktop-first**.

```text
Desktop:
- two lines mandatory
- line 1 never wraps
- line 2 never wraps
- tutorials visible

Preferred viewport width:
- >= 1600px

Supported viewport width:
- >= 1280px

Compact desktop mode:
- below 1280px, session controls may shrink first
- tutorial thumbnails may be hidden before transport is degraded
- no mobile reflow is required

Unsupported narrow mode:
- below 960px, full DAW layout is not guaranteed
- horizontal overflow is acceptable
```

### Wireframe ASCII

```text
Ligne 1
[LOGO]            [TUTO-L][RETURN][PLAY][TIMECODE][TUTO-R]            [?][EXPORT]

Ligne 2
                  [SESSION COMBO........................][SAVE][LOAD][DELETE]
```

### Statut

Cette toolbar cible :

- conserve la ligne transport comme ligne principale ;
- déporte les contrôles de session sur une seconde ligne compacte ;
- adopte explicitement une stratégie desktop-first, non mobile.
