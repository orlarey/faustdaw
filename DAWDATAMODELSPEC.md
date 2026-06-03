# Modèle de données du DAW

## Cadrage

Ce document décrit l'**ensemble** des données vivantes à un instant donné dans
l'application — pas seulement ce qui est sauvegardé. Il s'agit d'un modèle
conceptuel et mathématique : les relations décrites ne sont ni un schéma
d'implémentation, ni une prescription de stockage.


Il sert de référence partagée pour raisonner sur le cycle de vie d'une donnée (création, mutation, persistance, reconstitution), pour identifier les relations entre concepts (par valeur ou par hash), et pour distinguer ce qui définit le projet de l'utilisateur de ce qui n'est qu'un cache de rendu ou un état de geste.

La présentation est strictement relationnelle, **conforme à la 1NF** : aucun attribut n'est un tableau, un set, une map ou un blob ; toute collection est éclatée dans une table d'association. L'ordre est porté par une colonne explicite. Les types opaques (objets WebAudio, éléments DOM, objets compilés Faust) sortent du modèle conceptuel — ils sont décrits comme « graphe d'objets externe associé à telle table par identifiant ». Les unions discriminées sont éclatées en une table par variant, avec une table-mère portant le discriminator.

## Notation

Chaque relation est notée

```
NomRelation = (**clef primaire**, attribut : type, attribut → AutreRelation, …)
```

avec ces conventions :

- **`**…**`** — la zone entre étoiles est la **clef primaire**. Quand elle est composite, les colonnes sont séparées par des virgules.
- **`→ Table`** — l'attribut est une **clef étrangère** vers la PK de `Table`. Le type de l'attribut vaut implicitement le type de la PK référencée. Si plusieurs colonnes consécutives forment ensemble une FK composite, on les énumère avant la flèche : `attr1, attr2 → Table`.
- **`?`** — suffixe sur le type ou sur la table cible : valeur optionnelle (`name : string?`, `track_id → Track?`).
- **`{a, b, c}`** — type énuméré.
- **`[1]`** ou **`[0..1]`** — cardinalité de la table : exactement une ligne (singleton obligatoire) ou au plus une ligne (singleton optionnel). Sans annotation, la cardinalité est libre.
- Les attributs dont le nom ne suffit pas à expliciter le rôle sont commentés en prose **après** la définition de la table — la signature reste mathématiquement propre.

## Durée de vie

Chaque table porte un marqueur :

| Marqueur | Sens |
|---|---|
| 💾 | Document du projet (persisté avec le projet) |
| 📚 | Persistance latérale (IDB : preset library, trajectory log) — survit à la suppression de l'instance qui l'a créée |
| 🔄 | Métadonnées de session (workspace IDB) |
| ⚡ | Runtime in-memory, reconstitué au reload |
| 🎯 | Geste in-flight |

**Règle structurante** : passer du niveau N au niveau N+1 doit être reproductible à partir des niveaux ≤ N.

## A. Document du projet 💾

```
Project[1]            = (**id : ProjectId**, sample_rate : int, timeline_cursor : int,
                         timeline_transport : {Stopped, Playing}, master_gain : float)

AudioResource         = (**id : ResourceId**, project_id → Project,
                         sample_rate : int, channels : int, length_samples : int)

AudioSample           = (**resource_id → AudioResource, channel : int, frame_index : int**,
                         value : float)

FxResource            = (**id : FxResourceId**, project_id → Project,
                         name : string, code : string)

FxResourceParamSpec   = (**fx_resource_id → FxResource, address : string**,
                         min : float, max : float, default : float, step : float, label : string)

Track                 = (**id : TrackId**, project_id → Project, position : int,
                         label : string, gain : float, pan : float, mute : bool, solo : bool)

Clip                  = (**id : ClipId**, track_id → Track, resource_id → AudioResource,
                         name : string?, start_coord : int,
                         source_start_sample : int?, source_length_samples : int?)

ClipOnset             = (**clip_id → Clip, onset_index : int**, frame_index : int)

FxChain               = (**id : FxChainId**)

FxSlot                = (**id : FxSlotId**, chain_id → FxChain, position : int,
                         fx_resource_id → FxResource, bypassed : bool)

FxSlotParam           = (**slot_id → FxSlot, address : string**, value : float)

TrackChain            = (**track_id → Track**, chain_id → FxChain [UNIQUE])

TransformChain        = (**project_id → Project**, chain_id → FxChain [UNIQUE])
```

- **`AudioSample.value`** porte une valeur PCM ; un canal et un frame_index par ligne.
- **`FxResourceParamSpec`** est la **signature paramètres** dérivée du code Faust de la `FxResource` : c'est elle qui définit les bornes (`min`, `max`, `default`, `step`) et le label, partagés par toutes les instances utilisant cette resource. La valeur courante d'une instance vit dans `FxSlotParam`.
- **`FxChain` est l'unité de routage** — une suite ordonnée de slots, indépendante de qui l'héberge. `TrackChain`, `TransformChain` (et plus tard `ClipAlgoChain`, etc.) sont des tables d'**attachement** entre un hôte et une chain. Toutes les FK externes qui visent un slot pointent vers `FxSlot` directement, sans polymorphie.
- **Contraintes** :
  - Pas de chevauchement temporel entre clips d'un même `Track`.
  - Au sein d'une même chain, deux slots ne partagent pas la même position : `(chain_id, position)` est unique dans `FxSlot`.
  - Une `FxChain` est référencée par **exactement une** ligne sur l'union des tables d'hosting (`TrackChain ∪ TransformChain ∪ …`) — contrainte sémantique non exprimable en relationnel pur, énoncée en prose.

## B. Bibliothèque de presets 📚

```
PresetRecord       = (**ui_hash : string, config_hash : string**,
                      name : string?, first_seen_at : int, last_seen_at : int)

PresetConfigEntry  = (**ui_hash, config_hash → PresetRecord, address : string**, value : float)
```

- **`ui_hash`** identifie la signature paramètres (commune à tout effet Faust dont le code expose la même UI) ; **`config_hash`** identifie la configuration. Pas de FK vers `FxResource` ni vers un slot : la liaison passe par hash, ce qui rend les presets robustes à la disparition du slot qui les a créés.

## C. Trajectoires 📚

```
TrajectoryRecord       = (**session_id : string, slot_id : FxSlotId**,
                          code_hash : string, head_index : int, cursor_index : int,
                          updated_at : int)

TrajectoryEvent        = (**session_id, slot_id → TrajectoryRecord, event_index : int**,
                          timestamp_ms : int, transition_time_ms : int?,
                          transition_level : int?, loop_context : string?)

TrajectoryEventConfig  = (**session_id, slot_id, event_index → TrajectoryEvent,
                          address : string**, value : float)
```

- **`code_hash`** valide la cohérence : si le code Faust change, le log est invalidé.
- **`head_index`** = dernier event committé (`-1` si vide). **`cursor_index`** = position du curseur de navigation (`-1` si détaché).
- **`transition_level ∈ {0, 1}`** : niveau de transition dynamique (PRESETSPEC).

## D. État de session 🔄

```
SessionState           = (**id : string**, tab_id : string, name : string,
                          revision : string?, in_workspace : bool,
                          access_mode : {writer, follower})

WorkspaceSessionsIndex = (**session_id : string**,
                          session_name : string, session_revision : string)

ProjectUndoEntry       = (**session_id → SessionState, stack : {past, future}, position : int**,
                          version_id : int)
```

- **`tab_id`** sert au verrou writer / follower entre onglets.
- **`revision`** = hash du `SessionDocument` courant ; `null` jusqu'au premier autosave.
- **`ProjectUndoEntry`** désigne une version archivée du document. Le **versionnage complet** des tables A (qui ajouterait un `valid_from_version` / `valid_to_version` sur chaque ligne) est hors-scope ici — couvert par UNDOREDOSPEC.

## E. Sélection ⚡

```
SelectionState[1]   = (primary_clip_id → Clip?)

SelectedClip        = (**clip_id → Clip**)
```

- `SelectionState` est un singleton ; `SelectedClip` matérialise le set des clips sélectionnés.

## F. Runtime audio ⚡

Les **objets WebAudio** sont externes au modèle relationnel — entités opaques gérées par le navigateur. Les tables ci-dessous décrivent les associations entre identifiants du domaine et le graphe audio externe, sans représenter le graphe lui-même.

```
AudioEngineState[1]         = (context_ready : bool, master_node_ready : bool,
                               keep_alive_active : bool)

PlaybackSession[0..1]       = (transport_start_coord : int, audio_start_time : float)

PlaySelectionState[0..1]    = (has_clip_filter : bool,
                               loop_range_start : int?, loop_range_end : int?)

PlaySelectionFilterClip     = (**clip_id → Clip**)

TrackPlaybackMix            = (**track_id → Track**,
                               level : float, pan : float, muted : bool, solo : bool,
                               input_node_ready : bool, output_node_ready : bool)

TrackPlaybackPlan           = (**id : int**, track_id → Track,
                               anchor_time : int, end_time : int,
                               status : {active, next, retiring}, activated : bool)

TrackPlaybackEvent          = (**plan_id → TrackPlaybackPlan, event_index : int**,
                               clip_id → Clip,
                               start_offset_in_plan : int, stop_offset_in_plan : int,
                               offset_in_buffer_frames : int)

FxSlotRuntime               = (**slot_id : FxSlotId**, compiled : bool)
```

- **`PlaybackSession`** mappe la coordonnée transport à l'horloge audio (`audio_start_time` en secondes WebAudio).
- **`TrackPlaybackEvent.offset_in_buffer_frames`** est l'offset dans le buffer source au moment de la planification.

## G. Caches dérivés ⚡

```
AudioResourceBuffer  = (**resource_id → AudioResource**, ready : bool)

Projection           = (**id : int**, ui_hash : string,
                        kind : {empty, single, oneD, full})

ProjectionVector     = (**projection_id → Projection,
                         vector_kind : {centroid, u1, u2}, dimension_index : int**,
                        value : float)
```

- Caches reproductibles à partir du document (PCM décodé) ou de la library (PCA pondérée). `ready : bool` signale l'existence du cache sans en exposer le contenu opaque.

## H. Système de tracking presets ⚡

```
PresetTrackingInstance       = (**slot_id : FxSlotId**,
                                session_id → SessionState,
                                code_hash : string, ui_hash : string)

PresetTrackingInGesture      = (**slot_id → PresetTrackingInstance**)

PresetTrackingOverlayActive  = (**slot_id → PresetTrackingInstance**)
```

- `PresetTrackingInGesture` et `PresetTrackingOverlayActive` matérialisent les sets d'instances pour lesquels la promotion automatique de presets est suspendue (drag en cours / calque ouvert).

## I. Calques presets ⚡

```
PresetOverlay         = (**slot_id : FxSlotId**,
                         ui_hash : string, visible : bool,
                         drag_mode : {centre, rect, none},
                         active_preset_ui_hash : string?,
                         active_preset_config_hash : string?,
                         projection_id → Projection?,
                         centre_x : float?, centre_y : float?,
                         selection_start_x : float?, selection_start_y : float?,
                         selection_end_x : float?, selection_end_y : float?,
                         transition_active : bool)

OverlayPresetOrder    = (**slot_id → PresetOverlay, position : int**,
                         preset_ui_hash, preset_config_hash → PresetRecord)

OverlaySelectedConfig = (**slot_id → PresetOverlay,
                          preset_ui_hash, preset_config_hash → PresetRecord**)
```

- **`OverlayPresetOrder`** matérialise l'ordre dans lequel les presets sont projetés (calcul Shepard / PCA).
- **`OverlaySelectedConfig`** est la multi-sélection pour le batch-delete.

## J. Undo scopes ⚡ (autres que project)

Snapshots embarqués : copies indépendantes (pas des FK vers le document) de `PresetRecord` ou d'un slot d'effet, pour survivre à leur suppression.

```
PresetRecordSnapshot       = (**snapshot_id : int**,
                              ui_hash : string, config_hash : string, name : string?,
                              first_seen_at : int, last_seen_at : int)

PresetRecordSnapshotConfig = (**snapshot_id → PresetRecordSnapshot, address : string**,
                              value : float)

FxSlotSnapshot             = (**snapshot_id : int**, original_slot_id : FxSlotId,
                              fx_resource_id → FxResource)

FxSlotSnapshotParam        = (**snapshot_id → FxSlotSnapshot, address : string**,
                              value : float)
```

### Library scope (3b)

```
LibraryUndoOp         = (**ui_hash : string, stack : {past, future}, position : int**,
                         kind : {add, rename, delete, delete_batch})

LibraryAddOp          = (**ui_hash, stack, position → LibraryUndoOp**,
                         record_snapshot_id → PresetRecordSnapshot)

LibraryDeleteOp       = (**ui_hash, stack, position → LibraryUndoOp**,
                         record_snapshot_id → PresetRecordSnapshot)

LibraryRenameOp       = (**ui_hash, stack, position → LibraryUndoOp**,
                         target_ui_hash : string, target_config_hash : string,
                         prev_name : string?, next_name : string?)

LibraryDeleteBatchOp  = (**ui_hash, stack, position → LibraryUndoOp**)

LibraryDeleteBatchItem = (**ui_hash, stack, position → LibraryDeleteBatchOp,
                           item_index : int**,
                          record_snapshot_id → PresetRecordSnapshot)
```

### Chain scope (1)

```
ChainUndoOp       = (**chain_id → FxChain, stack : {past, future}, position : int**,
                     kind : {add, remove, move, bypass})

ChainAddOp        = (**chain_id, stack, position → ChainUndoOp**,
                     slot_snapshot_id → FxSlotSnapshot,
                     target_index : int, bypassed : bool)

ChainRemoveOp     = (**chain_id, stack, position → ChainUndoOp**,
                     slot_snapshot_id → FxSlotSnapshot,
                     target_index : int, bypassed : bool)

ChainMoveOp       = (**chain_id, stack, position → ChainUndoOp**,
                     slot_id → FxSlot, from_index : int, to_index : int)

ChainBypassOp     = (**chain_id, stack, position → ChainUndoOp**,
                     slot_id → FxSlot)
```

- Le scope chain s'identifie directement par `chain_id` — plus besoin de discriminator `{fxChain, transformChain}` ni de FK conditionnelle vers `Track`. Une pile par `FxChain`, peu importe son hôte.

### Faust FX scope (2)

```
FaustFxUndoOp        = (**slot_id : FxSlotId, stack : {past, future}, position : int**,
                        kind : {params})

FaustFxParamSnapshot = (**slot_id, stack, position → FaustFxUndoOp,
                         when : {before, after}, address : string**, value : float)
```

- `kind` est dégénéré (un seul variant `params`) — on garde la table-mère `FaustFxUndoOp` pour la cohérence avec les autres scopes et l'extensibilité (futurs op kinds : `code_edit` etc.).

## K. Viewport et UI ⚡

```
TimelineViewport[1]  = (view_start_coord : int, view_duration_coord : int,
                        time_scale_zoom_index : int,
                        grid_width_px : int, grid_height_px : int)

FooterView[1]        = (message : string?, tone : {neutral, error, scope})
```

## L. Gestes en cours 🎯

Singletons optionnels — au plus une instance active à la fois.

```
DragState[0..1]            = (primary_clip_id → Clip,
                              pointer_id : int, grab_time : int,
                              pointer_offset_coord : int, pointer_offset_track : int,
                              last_pointer_x : float, last_pointer_y : float,
                              raw_preview_start : int, preview_start : int,
                              preview_track_id → Track,
                              duplicate_on_drag : bool, preview_detached : bool)

DragSourcePlacement        = (**clip_id → Clip**, start_coord : int, track_id → Track)

DragPreviewPlacement       = (**clip_id → Clip**, preview_clip_id : ClipId,
                              start_coord : int, track_id → Track)

AlignmentGuide             = (**guide_index : int**, coord : int)

SelectionRectState[0..1]   = (pointer_id : int,
                              start_pointer_x : float, start_pointer_y : float,
                              last_pointer_x : float, last_pointer_y : float,
                              active : bool)

RulerDragState[0..1]       = (pointer_id : int,
                              last_pointer_x : float, last_pointer_y : float,
                              accumulated_zoom_delta : float,
                              gesture_mode : {pan, zoom, unresolved})

ClipOnsetEditorState[0..1] = (clip_id → Clip)

WorkingClipOnset           = (**clip_id → ClipOnsetEditorState, onset_index : int**,
                              frame_index : int)
```

- **`DragSourcePlacement`** = position originale des clips draggés (pour annulation).
- **`DragPreviewPlacement`** = position prévisionnelle pendant le drag.
- **`AlignmentGuide`** = lignes d'aimantation visibles à l'instant t.
- **`WorkingClipOnset`** = onsets en cours d'édition avant validation.

## M. Preview audio 🎯

```
FaustTransformPreview[0..1] = (clip_id → Clip, selected_effect_index : int)

RealtimeExport[0..1]        = (target_clip_id → Clip?, progress_percent : float)
```

## Diagramme des principales relations

```
                       PROJECT DOCUMENT (💾)
                       ─────────────────────
   AudioResource ── AudioSample
       ▲
       │
      Clip ── ClipOnset
       ▲
       │
     Track ── TrackChain ──┐
                            ↓
     (Project) ── TransformChain ──→ FxChain ── FxSlot ── FxSlotParam
                            ↑                      │
                            │                      ↓
                       (futurs hosts)         FxResource ── FxResourceParamSpec

                       LIBRARY (📚)                TRAJECTORIES (📚)
                       ─────────                   ─────────────────
                  PresetRecord ── PresetConfigEntry
                       │
                       │ ui_hash                   TrajectoryRecord
                       │                                ├── TrajectoryEvent
                       │                                │       └── TrajectoryEventConfig
                       │                                code_hash
       ┌───────────────┘
       │ (projection)
       │
   PresetOverlay ── OverlayPresetOrder ─→ PresetRecord
        │      │
        │      └── OverlaySelectedConfig ─→ PresetRecord
        │
        └── Projection ── ProjectionVector

                       UNDO SCOPES (⚡)
                       ────────────────
   LibraryUndoOp ── { Add, Rename, Delete, DeleteBatch }
                              ↓
                   PresetRecordSnapshot ── PresetRecordSnapshotConfig

   ChainUndoOp (par FxChain) ── { Add, Remove, Move, Bypass }
                                          ↓
                            FxSlotSnapshot ── FxSlotSnapshotParam

   FaustFxUndoOp ── FaustFxParamSnapshot

   ProjectUndoEntry ── (versionnage du document A — hors-scope)

                       RUNTIME / SESSION
                       ─────────────────
   SessionState 🔄 ── ProjectUndoEntry 🔄
   TrackPlaybackMix ⚡ ── TrackPlaybackPlan ── TrackPlaybackEvent ─→ Clip
   FxSlotRuntime ⚡ ─→ (FxSlotId)
   PresetTrackingInstance ⚡ ── { InGesture, OverlayActive }

                       GESTES 🎯
                       ─────────
   DragState ── { DragSourcePlacement, DragPreviewPlacement, AlignmentGuide }
   SelectionRectState · RulerDragState
   ClipOnsetEditorState ── WorkingClipOnset
   FaustTransformPreview · RealtimeExport
```

## Propriétés qui se lisent dans le modèle

1. **Indépendance des hash-liaisons.** Les ponts entre le document, la library et les trajectoires passent par hash (`ui_hash`, `code_hash`), jamais par FK directes. La suppression d'un slot ne casse ni la library ni la trajectoire — elles deviennent simplement orphelines, mais re-trouvables par tout autre slot partageant la même signature.

2. **Reproductibilité du runtime.** Tout ce qui est ⚡ doit pouvoir se reconstituer à partir du document 💾 + des persistances latérales 📚 + des métadonnées de session 🔄. Si une donnée n'est ni reconstructible ni persistée, c'est un bug — ou il faut la promouvoir au niveau supérieur.

3. **Granularité des undo scopes.** Chaque scope correspond à une zone du modèle :
   - Library 3b ↔ `PresetRecord` + `PresetConfigEntry`
   - Faust FX 2 ↔ `FxSlotParam` (snapshots dans `FaustFxParamSnapshot`)
   - Chain 1 ↔ `FxSlot` au sein d'une `FxChain` (snapshots dans `FxSlotSnapshot` pour add/remove). Une pile par `FxChain`, peu importe l'hôte.
   - Project 0 ↔ versionnage de tout le document A

4. **Snapshots embarqués.** Les ops d'undo qui doivent survivre à la suppression de leur cible portent des copies indépendantes (`PresetRecordSnapshot`, `FxSlotSnapshot`) — pas des FK. Conséquence : on peut undo-recréer un `PresetRecord` ou un slot qui n'existe plus.

5. **Singletons** (`Project[1]`, `AudioEngineState[1]`, `TimelineViewport[1]`, `FooterView[1]`, `SelectionState[1]`, `DragState[0..1]`, …). Tables à cardinalité contrainte, équivalent strict d'une « config globale » ou d'un état mutuellement exclusif.

6. **Chain comme unité de routage uniforme.** `FxChain` existe par elle-même, indépendamment de qui l'héberge. `TrackChain`, `TransformChain` (et plus tard `ClipAlgoChain` pour les clips algorithmiques) sont des tables d'association host → chain, structurellement équivalentes. Une seule table `FxSlot` suffit, et toutes les FK externes pointent vers `FxSlot` ou `FxChain` sans polymorphie. Ajouter un nouveau type d'hôte ne modifie ni `FxSlot` ni la sémantique de l'undo chain — juste une nouvelle table d'attachement.

7. **Gestes hors-document.** Les états 🎯 sont volontairement modélisés : ils n'existent que pendant un drag, mais leur structure invariante (preview placements, alignment guides, marquee bounds) mérite d'être nommée — et permet de raisonner sur les transitions entre gestes (mutuellement exclusifs).

## Hors-scope

- **Versionnage des tables du document A** pour l'undo project monolithique. Le mécanisme est couvert par UNDOREDOSPEC ; sa modélisation relationnelle ajouterait un `version_id` à chaque table A.
- **Schéma IndexedDB** (clés composées de stockage, indexes secondaires) — décrit dans `session-workspace.ts`.
- **Mécanisme de scheduling** des `TrackPlaybackPlan` (algorithme de génération du prochain plan, fade-out des `retiring`) — couvert ailleurs.
- **Algorithmes de projection** (PCA pondérée, Shepard) — couverts par PRESETSPEC.
- **Routage et cohérence** des Cmd+Z (focus, fall-through, bifurcation locale) — couverts par UNDOREDOSPEC et UNDOREDOSPEC-WEBDAW.
- **Le graphe d'objets WebAudio** — externe au modèle ; les tables de runtime audio référencent l'existence d'objets sans en décrire la structure.
