# Faust Code Editor — Specification

## Objectif

Permettre à l'utilisateur de modifier le code source Faust d'un effet
directement dans le DAW, via un éditeur de code intégré dans une fenêtre
modale. L'éditeur est accessible depuis un bouton ✏️ dans la toolbar de
chaque effet (FX chain de piste et Transform panel).

## Point d'entrée

Dans la toolbar de chaque effet, un bouton **edit** (icône crayon) est
ajouté entre l'indicateur de canaux (`1→2`) et le bouton bypass (`●`).
Le bouton est présent dans les deux contextes :

- **FX chain de piste** (`fx-chain-panel.ts`)
- **Transform panel** (`faust-transform-panel.ts`)

## Empilement des fenêtres

L'éditeur s'empile au-dessus des autres fenêtres modales. L'ordre de
la pile Z est :

1. **DAW** (fenêtre principale)
2. **Transform panel** (si ouvert) — `z-index: 9000`
3. **Éditeur Faust** — `z-index: 9500`

Un seul éditeur est ouvert à la fois. Ouvrir l'éditeur pour un autre
effet ferme l'éditeur précédent (sans avertissement, le code non
compilé est perdu — le code compilé reste dans la `FxResource`).

## Fenêtre modale de l'éditeur

### Apparence

- Fenêtre modale flottante, similaire au Transform panel :
  semi-transparente (`backdrop-filter: blur`), draggable par sa barre
  de titre, resizable, bouton de fermeture `✕`.
- **Barre de titre** : nom de l'effet + indicateur de canaux + `✕`.
- **Zone d'édition** : CodeMirror 6 avec coloration syntaxique Faust,
  numéros de ligne. Occupe l'essentiel de la surface.
- **Zone d'erreur** : bandeau sous l'éditeur, masqué par défaut,
  affiche les erreurs de compilation en rouge.
- **Barre d'options** : toggle **Auto-compile** (mode livecoding).
- **Barre de boutons** en bas : **Compile**, **Revert**, **Close**.

### CodeMirror 6

- **Packages** : `@codemirror/view`, `@codemirror/state`,
  `@codemirror/language`, `@codemirror/commands`, `@codemirror/search`.
- **Thème** : thème sombre cohérent avec le DAW (couleurs proches de
  One Dark ou du thème existant).
- **Coloration syntaxique Faust** : un mode Lezer minimal pour Faust
  (mots-clés : `import`, `process`, `with`, `environment`, `library`,
  `declare`, `component`, etc. ; commentaires `//` et `/* */` ;
  strings ; nombres). Si un mode Faust complet est trop lourd, partir
  d'un mode C-like et ajouter les mots-clés Faust.
- **Extensions** : numéros de ligne, highlight de la ligne active,
  bracket matching, indentation automatique.

## Comportement

### Ouverture

Le code source est chargé depuis la `FxResource` référencée par
l'effet : `project.fxResources.get(effect.fxResourceId).code`.

### Édition et compilation

Deux modes de compilation :

1. **Mode manuel** (par défaut) : l'utilisateur clique sur **Compile**
   ou utilise un raccourci clavier (à définir, par exemple
   `Ctrl+Enter` / `Cmd+Enter`).

2. **Mode auto-compile** (livecoding) : la compilation se déclenche
   automatiquement après un délai de debounce (ex: 500ms) suivant la
   dernière frappe. Le toggle **Auto-compile** dans la barre d'options
   active/désactive ce mode.

### Compilation — succès

1. **Créer une nouvelle `FxResource`** avec le code modifié (on ne
   modifie jamais une ressource existante, même principe que les clips
   audio).
2. Mettre à jour l'effet pour pointer vers la nouvelle
   `fxResourceId`.
3. Détruire l'ancien runtime (node + factory).
4. Créer un nouveau runtime avec le code recompilé.
5. Valider le nombre de canaux (1-2 entrées, 1-2 sorties). Si
   incompatible → traiter comme une erreur (voir ci-dessous).
6. Restaurer les paramètres compatibles (même adresse) depuis les
   paramètres sauvegardés de l'effet. Les paramètres qui n'existent
   plus dans le nouveau code sont supprimés ; les nouveaux paramètres
   prennent leur valeur par défaut.
7. Reconnecter le noeud dans le graphe audio (rewire la chaîne).
8. Mettre à jour l'Orbit UI.
9. Rafraîchir le label de canaux dans la toolbar.
10. Commit undo/redo.
11. Effacer la zone d'erreur.
12. Message de statut dans la footbar : `"effectName" compiled
    successfully`.

### Compilation — erreur

- Le code modifié reste dans l'éditeur (l'utilisateur peut corriger).
- L'ancien runtime et l'ancien code restent en place (l'effet continue
  de fonctionner avec le code précédent).
- L'erreur de compilation est affichée dans la zone d'erreur sous
  l'éditeur (texte rouge, scrollable si nécessaire).
- Message dans la footbar : `Compilation failed: <message>`.

### Revert

Recharge le code depuis la `FxResource` actuelle de l'effet
(`project.fxResources.get(effect.fxResourceId).code`), annulant toutes
les modifications non compilées dans l'éditeur. Efface la zone
d'erreur.

### Close

Ferme la modale sans avertissement. Le code non compilé est perdu. Le
code compilé (dans la `FxResource`) reste inchangé.

## Immutabilité des ressources

Comme pour les clips audio, **on ne modifie jamais une `FxResource`
existante**. Chaque compilation réussie crée une nouvelle `FxResource`
avec un nouvel `id` et met à jour le `fxResourceId` de l'effet. Les
anciennes ressources restent dans le catalogue du projet (elles sont
référencées par l'historique undo/redo).

## Catalogue DSP (futur)

À terme, le projet maintiendra un catalogue interne de toutes les
`FxResource` créées par l'utilisateur, permettant de :

- Parcourir les DSP existants
- Réutiliser un DSP sur un nouvel effet
- Renommer / organiser les DSP

Ce catalogue n'est pas dans le périmètre de cette première
implémentation, mais l'architecture (immutabilité des `FxResource`,
`fxResources` map dans le projet) le supporte naturellement.

## Éléments DOM

```html
<div id="faust-editor" class="faust-editor" hidden>
  <div class="faust-editor-content">
    <div class="faust-editor-header">
      <span class="faust-editor-title">effectName</span>
      <span class="faust-editor-channels">1→2</span>
      <button id="faust-editor-close" class="fx-ctrl fx-ctrl-delete"
              title="Close">✕</button>
    </div>
    <div id="faust-editor-codemirror" class="faust-editor-code"></div>
    <div id="faust-editor-error" class="faust-editor-error" hidden></div>
    <div class="faust-editor-options">
      <label>
        <input id="faust-editor-autocompile" type="checkbox" />
        Auto-compile
      </label>
    </div>
    <div class="faust-editor-footer">
      <button id="faust-editor-compile"
              class="faust-editor-button faust-editor-button--compile">
        Compile
      </button>
      <button id="faust-editor-revert"
              class="faust-editor-button faust-editor-button--revert">
        Revert
      </button>
      <button id="faust-editor-close-btn"
              class="faust-editor-button faust-editor-button--close">
        Close
      </button>
    </div>
  </div>
</div>
```

## Architecture — DAG de concepts

L'éditeur suit le principe de Functional Coupling : chaque concept a
une cohésion interne forte, les dépendances entre concepts sont
explicites, unidirectionnelles et acycliques.

### Concepts et responsabilités

| Concept | Responsabilité | Matérialisation |
| ------- | -------------- | --------------- |
| **FxResource (domain)** | Données DSP (id, name, code). Immutable. | `src/domain/fx-chain.ts` |
| **FxChain (domain)** | Opérations sur le projet : `importFxResource`, `addEffect`, `removeEffect`, `updateEffectParameters` | `src/fx-chain.ts` |
| **FxChainRuntime** | Compilation Faust → AudioWorkletNode, gestion des runtimes (create, destroy, get) | `demo/fx-chain/fx-chain-runtime.ts` |
| **FaustEditor** | UI de l'éditeur de code, orchestration de la compilation, gestion CodeMirror | `demo/faust-editor/faust-editor.ts` |
| **FxChainPanel** | UI de la chaîne d'effets par piste | `demo/fx-chain/fx-chain-panel.ts` |
| **TransformPanel** | UI du panel de transformation | `demo/faust-transform/faust-transform-panel.ts` |

### Graphe de dépendances

```
FxChainPanel ───→ FaustEditor  (openEditor)
TransformPanel ──→ FaustEditor  (openEditor)

FaustEditor
  ├──→ FxChainRuntime      (compileFxEffect, destroyEffectRuntime, getEffectRuntime)
  ├──→ FxChain (domain)    (importFxResource, updateEffect fxResourceId)
  └──→ CodeMirror 6        (UI éditeur)

FxChainRuntime
  └──→ Faust WASM          (compiler, generator)

FxChain (domain)
  └──→ FxResource (domain) (type uniquement)
```

### Règles de découpage

1. **`faust-editor.ts` encapsule tout le concept éditeur.** Les panels
   (FxChainPanel, TransformPanel) n'appellent qu'une seule fonction
   `openEditor(effectId, context)`. Ils ne connaissent ni CodeMirror,
   ni la logique de recompilation depuis l'éditeur.

2. **L'éditeur ne manipule pas `demoState.project` directement** pour
   les opérations FxResource. Il passe par les opérations du domaine
   (`importFxResource`) pour créer une nouvelle ressource et par un
   callback de contexte pour mettre à jour le `fxResourceId` de
   l'effet et commit undo/redo.

3. **L'éditeur appelle `fx-chain-runtime`** pour la compilation et la
   gestion des runtimes. Il ne réimplémente pas la compilation.

4. **Pas de dépendance inverse** : `fx-chain-runtime` ne connaît pas
   l'éditeur ; les panels ne connaissent pas CodeMirror ; le domaine
   ne connaît ni les panels ni l'éditeur.

## Fichiers concernés

| Fichier | Modifications |
| ------- | ------------- |
| `demo/index.html` | Ajouter le bloc DOM de l'éditeur |
| `demo/bind-elements.ts` | Binder les éléments de l'éditeur |
| `demo/styles.css` | Styles de l'éditeur (modal, CodeMirror) |
| `demo/faust-editor/faust-editor.ts` | Logique de l'éditeur (nouveau) |
| `demo/fx-chain/fx-chain-panel.ts` | Bouton edit → appel `openEditor` |
| `demo/faust-transform/faust-transform-panel.ts` | Bouton edit → appel `openEditor` |
| `demo/fx-chain/fx-chain-runtime.ts` | Exposer les opérations nécessaires |
| `package.json` | Dépendances CodeMirror 6 |
