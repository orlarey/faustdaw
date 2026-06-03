# Spécification des Effets Audio Faust

## Problème

Le DAW ne possède actuellement aucun traitement audio entre les clips et la
sortie. La chaîne audio est :

```text
AudioBufferSourceNode → GainNode (fade) → GainNode (track) → StereoPannerNode → GainNode (master) → destination
```

Nous voulons introduire des effets audio temps réel programmés en Faust,
compilés en WebAssembly, et instanciés via AudioWorklet.

## But

Permettre à l'utilisateur d'insérer des effets Faust sur chaque piste et sur
le master, avec contrôle des paramètres en temps réel, tout en restant
compatible avec l'architecture de scheduling par plans existante.

## Première Décision

Les effets utilisent l'API AudioWorklet, pas ScriptProcessorNode.

### Pourquoi

- ScriptProcessorNode est déprécié ;
- AudioWorklet tourne sur un thread audio dédié ;
- la latence et la stabilité sont nettement meilleures ;
- c'est le seul chemin viable pour du traitement Wasm temps réel.

## Deuxième Décision

Le code Faust est compilé en WebAssembly côté client, dans le navigateur.

### Pourquoi

- pas de serveur de compilation nécessaire ;
- le compilateur Faust existe en version Wasm
  ([faustwasm](https://github.com/sletz/faustwasm)) ;
- l'utilisateur peut écrire, modifier et recompiler un effet sans quitter
  le DAW ;
- la compilation est rapide (< 1 seconde pour un effet typique).

### Comment

Le compilateur [`faustwasm`](https://github.com/sletz/faustwasm) prend un
programme Faust en entrée et produit :

- un module WebAssembly (le DSP) ;
- un descripteur JSON (paramètres, entrées/sorties, métadonnées).

Ce descripteur JSON est la source de vérité pour construire l'interface de
contrôle des paramètres.

## Troisième Décision

La chaîne audio d'une piste devient :

```text
clips → GainNode (fade) → [FX1 → FX2 → ... → FXn] → GainNode (track) → StereoPannerNode → master
```

Les effets s'insèrent entre le gain de fade des clips et le gain de volume de
la piste.

### Pourquoi

- les effets entendent le signal brut des clips, avant le volume de piste ;
- le volume et le pan restent des contrôles de mix post-effet ;
- c'est le comportement standard de tous les DAWs.

### Chaîne master

La chaîne master devient :

```text
somme des pistes → [MasterFX1 → ... → MasterFXn] → GainNode (master) → destination
```

Les effets master s'insèrent entre le point de sommation et le gain master.

## Quatrième Décision

Chaque effet est un AudioWorkletNode qui encapsule une instance Wasm.

### Comment

1. Le code Faust est compilé en Wasm via `faustwasm`.
2. Un `AudioWorkletProcessor` charge le module Wasm dans le thread audio.
3. Sa méthode `process()` appelle la fonction `compute()` du DSP Wasm.
4. Les paramètres sont exposés comme `AudioParam` sur le `AudioWorkletNode`.
5. Le nœud s'insère dans le graphe Web Audio comme tout autre `AudioNode`.

### Structure du processeur

```text
AudioWorkletProcessor {
  wasm: WebAssembly.Instance
  dsp: pointer vers la mémoire DSP
  process(inputs, outputs, parameters) {
    copier inputs → mémoire wasm
    mettre à jour les paramètres
    appeler compute(frames, inputPtr, outputPtr)
    copier mémoire wasm → outputs
  }
}
```

## Cinquième Décision

Le modèle de données d'un effet est un ADT immuable dans le domaine.

### Définition

```text
FaustEffect = {
  id: FaustEffectId           — identifiant unique
  name: string                — nom affiché (ex: "reverb", "delay")
  code: string                — code source Faust
  parameters: FaustParam[]    — valeurs courantes des paramètres
}

FaustParam = {
  address: string             — adresse Faust (ex: "/reverb/decay")
  value: number               — valeur courante
  min: number                 — borne inférieure
  max: number                 — borne supérieure
  default: number             — valeur par défaut
  step: number                — pas de quantification
  label: string               — label affiché
}
```

### Où sont les effets dans le modèle

La piste gagne un champ `effects` :

```text
Track = {
  ...champs existants
  effects: FaustEffect[]      — chaîne d'effets ordonnée
}
```

Le projet gagne un champ `masterEffects` :

```text
Project = {
  ...champs existants
  masterEffects: FaustEffect[]
}
```

L'ordre dans le tableau définit l'ordre de la chaîne de traitement.

## Sixième Décision

Les effets font partie du document de session.

### Pourquoi

- les effets et leurs paramètres doivent survivre à la sauvegarde et au
  rechargement ;
- les modifications d'effets doivent être couvertes par l'undo/redo ;
- le code Faust source est stocké dans le document pour permettre la
  recompilation.

### Format dans le document de session

```json
{
  "tracks": [
    {
      "gain": 1.0,
      "pan": 0,
      "muted": false,
      "solo": false,
      "effects": [
        {
          "id": "fx-001",
          "name": "reverb",
          "code": "import(\"stdfaust.lib\");\nprocess = dm.zita_rev1;",
          "parameters": [
            {
              "address": "/reverb/decay",
              "value": 2.5
            }
          ]
        }
      ],
      "clips": []
    }
  ],
  "masterEffects": []
}
```

Seuls `address` et `value` sont sérialisés pour les paramètres. Les bornes
et métadonnées sont reconstruites depuis le descripteur JSON à la
recompilation.

## Septième Décision

La compilation et l'instanciation sont séparées du modèle de données.

### Pourquoi

Le modèle de données (domaine) reste un arbre de valeurs immuables pures.

L'état runtime (instances Wasm, AudioWorkletNode) vit dans `demoState`,
exactement comme les `outputGain` et `outputPanner` des pistes aujourd'hui.

### Comment

```text
FaustEffectRuntime = {
  effectId: FaustEffectId
  workletNode: AudioWorkletNode | null
  wasmModule: WebAssembly.Module | null
  descriptor: FaustDescriptor | null
}
```

Le runtime est synchronisé avec le modèle domaine à chaque render, comme
`syncTrackOutputRuntime` synchronise les gains et pans aujourd'hui.

## Huitième Décision

Le compilateur Faust est chargé paresseusement.

### Pourquoi

- le compilateur Wasm pèse plusieurs Mo ;
- la majorité des sessions n'utilisent pas d'effets ;
- le chargement ne doit pas pénaliser le démarrage.

### Comment

Le module [`faustwasm`](https://github.com/sletz/faustwasm) est importé
dynamiquement (`import()`) au premier ajout d'effet. Un état de chargement
est visible dans l'UI.

## Neuvième Décision

Un effet peut être activé ou désactivé sans être supprimé.

### Pourquoi

- permet de comparer le signal avec et sans effet (bypass) ;
- préserve la configuration des paramètres ;
- opération instantanée et réversible.

### Comment

Le modèle gagne un champ `bypassed` :

```text
FaustEffect = {
  ...
  bypassed: boolean
}
```

Quand un effet est bypassed, son AudioWorkletNode est déconnecté du graphe
et remplacé par une connexion directe entre le nœud précédent et le suivant.

## Dixième Décision

Un ensemble d'effets de base est fourni sous forme de presets.

### Pourquoi

- l'utilisateur ne devrait pas devoir écrire du Faust pour commencer ;
- les presets servent de démonstration et de point de départ ;
- ils couvrent les besoins courants du mixage.

### Presets initiaux proposés

| Nom       | Description                        | Faust                          |
|-----------|------------------------------------|--------------------------------|
| Gain      | Gain simple avec dB               | `process = *(db2linear(g));`   |
| EQ3       | Égaliseur 3 bandes paramétrique   | `fi.low_shelf`, `fi.peak_eq`, `fi.high_shelf` |
| Reverb    | Réverbération stéréo              | `dm.zita_rev1`                 |
| Delay     | Délai stéréo avec feedback        | `de.delay` + feedback          |
| Compressor| Compresseur simple                | `co.compressor_mono`           |
| Chorus    | Chorus stéréo                     | modulation de délai             |

Ces presets sont des programmes Faust complets, stockés comme constantes
dans le code source du DAW.

## Onzième Décision

Les effets sont ajoutés par drag-and-drop de fichiers `.dsp`.

### Workflow utilisateur

1. Chaque piste expose un bouton ou une zone qui ouvre sa **liste d'effets**.
2. Au départ, cette liste est vide.
3. L'utilisateur **droppe un fichier `.dsp`** sur la liste d'effets d'une
   piste (ou sur la zone master).
4. Le DAW lit le fichier, compile le code Faust en Wasm, crée
   l'AudioWorkletNode et l'insère dans la chaîne audio de la piste.
5. L'effet apparaît dans la liste avec son nom (dérivé du nom de fichier ou
   des métadonnées Faust `declare name`).

### Opérations sur la liste d'effets

| Opération        | Geste                                                  |
|------------------|--------------------------------------------------------|
| Ajouter          | Drop d'un fichier `.dsp` sur la liste                  |
| Réordonner       | Drag interne d'un effet dans la liste (drag-and-drop)  |
| Supprimer        | Bouton de suppression sur chaque effet                 |
| Bypass           | Bouton on/off sur chaque effet                         |
| Remplacer le code| Drop d'un nouveau `.dsp` sur un effet existant         |

Le réordonnement modifie l'ordre de la chaîne de traitement audio en temps
réel : les AudioWorkletNodes sont reconnectés dans le nouvel ordre.

### Pourquoi le drag-and-drop de fichiers

- le workflow est direct et familier ;
- pas besoin d'un sélecteur de fichiers modal ;
- le même geste qui sert à importer de l'audio sert à importer des effets ;
- les fichiers `.dsp` sont de petits fichiers texte faciles à partager.

## Douzième Décision

L'interface de contrôle de chaque effet est générée par `faust-orbit-ui`.

### Pourquoi

- [`faust-orbit-ui`](https://www.npmjs.com/package/faust-orbit-ui) génère
  automatiquement une interface de contrôle à partir du descripteur JSON
  Faust ;
- l'interface correspond exactement à la déclaration UI du programme Faust ;
- le rendu utilise des Web Components personnalisés, intégrables directement
  dans le DOM du DAW ;
- pas besoin de construire manuellement des contrôles pour chaque effet.

### Comment

1. Le descripteur JSON produit par la compilation Faust contient l'arbre UI
   complet (groupes, sliders, boutons, bargraphs).
2. `faust-orbit-ui` prend ce descripteur et un nœud AudioWorkletNode et
   produit un élément DOM interactif.
3. Cet élément est inséré dans le panneau d'effets de la piste.
4. Les contrôles sont bidirectionnels : les gestes UI modifient les
   AudioParam du WorkletNode, et les valeurs du modèle domaine sont
   synchronisées.

### Représentation visuelle d'un effet dans la liste

```text
┌──────────────────────────────────────────┐
│ [bypass] reverb.dsp                  [×] │
│ ┌──────────────────────────────────────┐ │
│ │  Interface faust-orbit-ui            │ │
│ │  (sliders, boutons, groupes)         │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

Chaque effet dans la liste montre :

- un bouton bypass (on/off) ;
- le nom de l'effet ;
- un bouton de suppression ;
- l'interface de paramètres générée par `faust-orbit-ui`, dépliable ou
  toujours visible.

## Résumé de l'architecture

```text
┌─────────────────────────────────────────────────────────┐
│                       Session Document                  │
│  tracks[].effects[] ← code Faust + paramètres           │
│  masterEffects[]                                        │
└──────────────────────────┬──────────────────────────────┘
                           │ sync
┌──────────────────────────▼──────────────────────────────┐
│                       Runtime (demoState)                │
│  faustwasm compiler (lazy)                              │
│  per-effect: { wasmModule, workletNode, descriptor }    │
└──────────────────────────┬──────────────────────────────┘
                           │ connect
┌──────────────────────────▼──────────────────────────────┐
│                    Web Audio Graph                       │
│                                                         │
│  clip sources                                           │
│    → GainNode (fade)                                    │
│    → [AudioWorkletNode FX1 → ... → FXn]                │
│    → GainNode (track volume)                            │
│    → StereoPannerNode (pan)                             │
│    → master bus                                         │
│        → [AudioWorkletNode MasterFX1 → ... → MasterFXn]│
│        → GainNode (master volume)                       │
│        → destination                                    │
└─────────────────────────────────────────────────────────┘
```

## Non-goals explicites pour la première version

- pas d'effets par clip (uniquement par piste et master) ;
- pas d'éditeur de code Faust intégré (l'utilisateur édite ses `.dsp` dans
  un éditeur externe) ;
- pas de side-chain ou de routage entre pistes ;
- pas d'automatisation des paramètres par la timeline ;
- pas de latence compensée (plug-in delay compensation) ;
- pas d'import/export de presets utilisateur depuis un fichier externe ;
- pas de visualisation (VU-mètre, analyseur de spectre) dans les effets.

## Chemin d'implémentation recommandé

1. **Chargement paresseux de faustwasm** — `import()` dynamique au premier
   besoin.
2. **Compilation d'un programme Faust en Wasm** — entrée : code source,
   sortie : module Wasm + descripteur JSON.
3. **AudioWorkletProcessor générique** — un processeur unique capable de
   charger n'importe quel module Faust Wasm.
4. **Modèle de données** — ajouter `effects` aux pistes et `masterEffects`
   au projet.
5. **Graphe audio** — insérer les WorkletNodes dans la chaîne existante.
6. **Sérialisation** — sauvegarder et restaurer les effets dans le document
   de session.
7. **UI minimale** — sélecteur de preset, liste des effets par piste,
   contrôles de paramètres, bypass.
8. **Presets** — implémenter les 6 presets de base.
