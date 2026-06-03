# Spécification du Document de Session

## Problème

Nous voulons définir une représentation persistante de la session du DAW.

Cette représentation doit servir à trois usages distincts mais liés :

- sauvegarder une session sur disque ;
- recharger une session plus tard ;
- servir de frontière claire pour le système d'undo/redo.

Le point important est le suivant :

- les **ressources audio** sont des fichiers importés ;
- la **session** est l'organisation de ces ressources dans la timeline ;
- l'undo/redo doit porter sur la session, pas sur l'acte d'import lui-même.

Autrement dit :

- on ne veut pas "undo l'import d'un fichier audio" ;
- on veut "undo la création, suppression, duplication ou modification des clips et paramètres de piste qui composent la timeline".

## But

Nous voulons définir un **document de session** :

- sérialisable en JSON ;
- embarqué dans un conteneur `.zip` avec les ressources audio ;
- indépendant de l'état runtime ;
- suffisamment stable pour servir aussi de base à l'historique undo/redo.

## Principe général

La session est composée de deux couches :

- les **ressources**
- le **document de session**

Les ressources sont les fichiers audio bruts.

Le document de session décrit :

- les pistes ;
- leur état de mix éditorial ;
- la liste ordonnée des clips sur chaque piste ;
- la référence de ressource utilisée par chaque clip ;
- la position temporelle de chaque clip.

Le document de session ne décrit pas l'état purement transitoire de l'application.

## Conteneur

Une session sauvegardée est un fichier `.zip`.

Ce `.zip` contient :

- un fichier JSON décrivant la session ;
- un sous-ensemble de fichiers audio utilisés par la session.

Première convention proposée :

```text
session.zip
  session.json
  resources/
    <resource-id-1>.<ext>
    <resource-id-2>.<ext>
    ...
```

Le choix exact des extensions pourra être précisé plus tard.

Convention de nommage proposée pour le fichier exporté :

```text
<project-id>-YYYY-MM-DD-HHMMSS-session.zip
```

Exemple :

```text
demo-v0-2026-03-23-154812-session.zip
```

## Session de travail locale

En plus de l'export explicite en `.zip`, l'application peut maintenir une
**session de travail locale** persistée dans le stockage du navigateur.

Cette session de travail locale contient :

- le `session.json` courant ;
- les ressources audio effectivement utilisées ;
- les métadonnées minimales nécessaires pour reconstruire ces ressources.

Cette persistance locale a un but différent de l'export `.zip` :

- l'export `.zip` sert à sauvegarder, déplacer ou partager une session ;
- la session locale sert à retrouver automatiquement l'état de travail au
  prochain lancement du DAW.

Le mécanisme exact pourra être choisi plus tard parmi des solutions navigateur
adaptées, par exemple :

- `IndexedDB`
- `OPFS`
- ou une autre API locale équivalente

Le point important est conceptuel :

- il existe une **copie de travail locale persistée**
- distincte du **fichier d'export de session**

## Autosave

La session de travail locale peut être mise à jour automatiquement.

Objectif :

- retrouver la session courante lorsque l'utilisateur rouvre le DAW ;
- sans exiger un export manuel préalable.

Première règle proposée :

- l'autosave porte sur la **session de travail locale**
- pas sur la génération automatique d'un `.zip`

Autrement dit :

- le `.zip` reste une action explicite d'export
- l'autosave alimente la copie de travail locale du navigateur

## Document JSON

Le document JSON décrit uniquement la partie éditoriale de la session.

Première structure cible :

```json
{
  "version": 1,
  "sampleRate": 48000,
  "masterGain": 1,
  "tracks": [
    {
      "id": "track-1",
      "gain": 1,
      "pan": 0,
      "mute": false,
      "solo": false,
      "clips": [
        {
          "deltaTime": 0,
          "resourceId": "resource-1"
        },
        {
          "deltaTime": 230400,
          "resourceId": "resource-2"
        }
      ]
    }
  ]
}
```

## Représentation des clips

Dans une piste, les clips sont stockés dans l'ordre temporel.

Chaque clip est représenté par :

- une référence de ressource : `resourceId`
- une position relative : `deltaTime`

Le `deltaTime` est défini comme :

- pour le premier clip d'une piste : distance temporelle depuis `0`
- pour chaque clip suivant : distance temporelle depuis la fin du clip précédent

Cette représentation compacte suppose :

- un ordre temporel strict des clips par piste ;
- une absence de chevauchement entre clips d'une même piste ;
- une reconstruction déterministe des starts absolus au chargement.

Remarque :

- si cette représentation devient trop ambiguë ou peu pratique, on pourra revenir à une représentation explicite en `start`
- mais l'intention initiale est bien de stocker une timeline compacte en paires `(deltaTime, resourceId)`

## Paramètres inclus dans le document

Le document de session inclut :

- le `masterGain` global ;
- l'ordre fixe des pistes ;
- le `gain` de chaque piste ;
- le `pan` de chaque piste ;
- l'état `mute` de chaque piste ;
- l'état `solo` de chaque piste ;
- les clips de chaque piste ;
- la fréquence d'échantillonnage logique utilisée pour interpréter les coordonnées temporelles.

## Paramètres exclus du document

Le document de session n'inclut pas, à ce stade :

- l'état `Playing` / `Stopped`
- le zoom de la timeline
- le pan de viewport
- la sélection courante
- les panneaux ouverts/fermés
- les caches audio
- les pyramides de waveform
- les ressources importées mais non utilisées dans la session

Autrement dit :

- le document décrit le **contenu éditorial sauvegardable**
- pas le **contexte runtime**

## Ressources

Les ressources audio sont référencées par identifiant stable.

Le document de session ne contient pas les données audio elles-mêmes, seulement leurs références.

Le conteneur `.zip` doit fournir tous les fichiers nécessaires à ces références.

Première règle :

- seules les ressources effectivement utilisées par au moins un clip doivent être considérées comme appartenant à la session sauvegardée

## Conservation des ressources originales

Pour la session de travail locale, et idéalement aussi pour l'export, les
ressources doivent être conservées sous leur **forme originale importée**,
pas seulement sous une forme régénérée à partir d'un `AudioBuffer`.

Motivations :

- préserver exactement les données importées par l'utilisateur ;
- éviter une ré-encodage implicite ;
- permettre une restauration fidèle de la session ;
- préparer naturellement l'autosave local et la réouverture automatique.

Donc, au moment de l'import, il est légitime de conserver aussi :

- les bytes originaux du fichier ;
- son nom d'origine ;
- son type MIME ;
- et éventuellement d'autres métadonnées simples comme `lastModified`.

Le rendu runtime pourra continuer à dériver de buffers décodés et de caches,
mais la persistance de session doit raisonner sur la ressource originale.

## Undo / Redo

Le système d'undo/redo doit porter sur les **mêmes informations** que celles du document de session.

Autrement dit, l'historique doit capturer :

- le `masterGain`
- les pistes
- leur `gain`
- leur `pan`
- leur état `mute`
- leur état `solo`
- les clips
- leur ordre
- leur position
- leurs références de ressource

L'historique ne doit pas capturer :

- le pool runtime complet des ressources importées
- l'état de lecture
- la vue
- la sélection

## Conséquence architecturale

Le système devra distinguer explicitement :

- le **document de session**
- l'**état runtime dérivé**

Le document de session est :

- sérialisable ;
- sauvegardable ;
- versionnable ;
- restaurable ;
- undoable.

L'état runtime est :

- reconstruit à partir du document et de l'environnement navigateur ;
- non sérialisé ;
- non concerné par l'undo/redo.

## Première décision

La frontière conceptuelle de l'undo/redo est le **document de session**.

Donc :

- undo/redo n'opère pas sur `Project` complet ;
- undo/redo n'opère pas sur l'état UI ;
- undo/redo opère sur la projection éditoriale sérialisable de la session.

## Deuxième décision

L'import d'une ressource n'est pas en soi une opération undoable.

En revanche, les opérations undoables sont par exemple :

- création d'un clip ;
- suppression d'un clip ;
- déplacement d'un clip ;
- duplication d'un clip ;
- création, suppression, déplacement, duplication d'une multi-sélection ;
- modification du `gain` ou du `pan` d'une piste.

## Troisième décision

Le document doit être versionné.

Première règle :

- `session.json` contient un champ `version`

Cela permet d'introduire plus tard :

- d'autres paramètres de piste ;
- des effets ;
- des automations ;
- des métadonnées de session ;
- une autre représentation temporelle si nécessaire.

## Point ouvert

Il reste à préciser plus tard :

- la forme exacte de l'identifiant de ressource ;
- la stratégie de nommage des fichiers dans `resources/` ;
- la représentation exacte de `deltaTime` ;
- la place éventuelle d'un curseur de session sauvegardé ;
- la présence ou non de métadonnées globales supplémentaires ;
- le backend exact de persistance locale navigateur ;
- le moment exact où déclencher l'autosave ;
- l'alignement complet entre export `.zip` et copie de travail locale.
