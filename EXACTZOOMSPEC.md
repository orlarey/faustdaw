# Spécification du Zoom Exact de la Timeline

## Problème

Nous voulons redéfinir le système de zoom et de grille de la timeline de sorte
que la relation entre temps audio, samples et pixels reste toujours exacte au
niveau géométrique utile.

Le problème actuel est le suivant :

- certaines largeurs de grille tombent sur des valeurs fractionnaires ;
- certaines subdivisions temporelles doivent être arrondies en pixels ;
- ces arrondis produisent des irrégularités visibles dans la grille et dans le
  rendu de waveform.

Nous voulons éliminer cette classe de problèmes.

## But

À chaque niveau de zoom discret, nous voulons garantir l'une des deux formes
suivantes :

```text
1 pixel = N samples
```

ou

```text
1 sample = N pixels
```

avec `N ∈ N`.

Autrement dit :

- soit un pixel représente un nombre entier de samples ;
- soit un sample représente un nombre entier de pixels ;
- jamais une relation fractionnaire du type `1 pixel = 2.3 samples` ;
- jamais une relation fractionnaire du type `1 sample = 3.7 pixels`.

## Principe général

Le système de zoom devient un ensemble **discret** de niveaux exacts.

Chaque niveau de zoom est défini par :

- une relation exacte `pixels <-> samples` ;
- une grille géométrique exacte compatible avec cette relation ;
- une politique de labels adaptée à la `sampleRate`.

Le pivot naturel du système est :

```text
1 pixel = 1 sample
```

Les niveaux plus fins sont :

```text
2 px/sample
4 px/sample
8 px/sample
16 px/sample
```

Les niveaux plus grossiers sont :

```text
2 samples/pixel
4 samples/pixel
8 samples/pixel
...
```

## Première décision

Le niveau de zoom le plus fin est :

```text
16 pixels par sample
```

Ce choix fournit :

- une excellente lisibilité de la forme d'onde ;
- une base simple en puissances de 2 ;
- un point de départ propre pour une suite de niveaux discrets exacts.

## Deuxième décision

La maille géométrique fondamentale du zoom le plus fin est le **sample**.

Autrement dit :

- la plus petite subdivision de grille est `1 sample` ;
- cette subdivision doit toujours tomber sur un nombre entier de pixels ;
- au niveau le plus fin retenu :

```text
1 sample = 16 px
```

## Troisième décision

Il faut distinguer :

- la **grille géométrique** ;
- les **labels UX**.

La grille géométrique doit rester exacte en samples.

Les labels doivent rester lisibles et utiles pour l'utilisateur, même si leur
unité n'est pas toujours celle de la maille géométrique fondamentale.

Autrement dit :

- géométrie : contrainte d'exactitude ;
- labels : contrainte de lisibilité et de repérage.

## Quatrième décision

À `48 kHz`, le niveau de zoom le plus fin est organisé ainsi :

- grille tertiaire : `1 sample`
- grille secondaire : `0.25 ms = 12 samples`
- grille primaire : `1 ms = 48 samples`

Avec `16 px/sample`, cela donne :

- tertiaire : `16 px`
- secondaire : `192 px`
- primaire : `768 px`

Cette hiérarchie est exacte, régulière et lisible.

## Cinquième décision

À `48 kHz`, les labels pertinents au zoom le plus fin sont les millisecondes.

Donc :

- la grille primaire est exprimée en millisecondes ;
- la grille secondaire peut être exprimée en fractions simples de milliseconde ;
- la grille tertiaire reste la maille sample exacte.

Autrement dit, à `48 kHz` :

- la géométrie est sample-based ;
- l'UX reste millisecond-based.

## Sixième décision

À `44.1 kHz`, les millisecondes ne tombent pas exactement sur un nombre entier
de samples :

```text
1 ms = 44.1 samples
```

Donc il ne faut pas forcer une grille géométrique sous-millisecondes exprimée
en millisecondes.

## Septième décision

À `44.1 kHz`, toute subdivision **strictement inférieure à `10 ms`** est
exprimée en numéros d'échantillons.

Autrement dit :

- au-dessus ou à partir de `10 ms`, les labels temporels en millisecondes
  restent naturels ;
- en dessous de `10 ms`, le repère utilisateur devient le sample.

Cela permet de conserver :

- l'exactitude géométrique ;
- une sémantique claire ;
- une UX cohérente à très fort zoom.

## Huitième décision

Le système de zoom exact dépend de la `sampleRate` du projet.

Comme le player adopte une seule `sampleRate`, celle du `AudioContext`, le
projet n'a qu'une seule famille de niveaux de zoom exacts à un instant donné.

Donc :

- le système de zoom exact est construit pour la `sampleRate` courante ;
- il peut différer entre `48 kHz` et `44.1 kHz` ;
- il n'a pas besoin d'être identique entre toutes les fréquences.

## Neuvième décision

Dans un même niveau de zoom, la hiérarchie des divisions doit rester entière.

Autrement dit, si :

- `T` est la division tertiaire ;
- `S` est la division secondaire ;
- `P` est la division primaire ;

alors on doit avoir :

```text
S = k × T
P = l × S
```

avec :

- `k ∈ N`
- `l ∈ N`

Donc :

- la secondaire doit être un multiple entier de la tertiaire ;
- la primaire doit être un multiple entier de la secondaire ;
- une hiérarchie du type `T = 8`, `S = 12`, `P = 48` est invalide car
  `12 / 8 = 1.5`.

Cette contrainte est structurelle :

- elle ne dépend pas seulement de la lisibilité ;
- elle garantit que la grille reste mathématiquement cohérente d'un niveau à
  l'autre ;
- elle interdit les familles de divisions qui ne s'emboîtent plus proprement.

## Forme tabulaire

Les choix de zoom exact doivent être exprimés sous la forme d'un tableau.

Chaque ligne du tableau décrit un niveau de zoom discret.

La forme canonique retenue est :

| Niveau | Z | T | S/T | S | P/S | P |
|--------|---|---|-----|---|-----|---|

avec les significations suivantes :

- `Niveau` : indice discret du zoom ;
- `Z` : relation exacte de zoom ;
- `T` : division tertiaire ;
- `S/T` : ratio entier entre secondaire et tertiaire ;
- `S` : division secondaire, avec son unité UX ;
- `P/S` : ratio entier entre primaire et secondaire ;
- `P` : division primaire, avec son unité UX.

## Notation compacte

En complément du tableau, chaque niveau peut être résumé par une notation
compacte :

```text
niveau : Zpx/s ; Tpx/s ; Spx/s unité ; Ppx/s unité
```

où :

- `Z` = relation exacte de zoom ;
- `T` = division tertiaire ;
- `S` = division secondaire ;
- `P` = division primaire ;
- `px/s` signifie `pixels / samples` ;
- `unité` indique l'unité UX des labels.

Les unités autorisées sont :

- `e` : échantillon
- `m` : milliseconde
- `c` : `10 ms`
- `d` : `100 ms`
- `s` : seconde
- `M` : minute
- `H` : heure

Exemple :

```text
0 : Z16/1 ; T16/1 ; S192/12 e ; P768/48 m
```

Lecture :

- `Z16/1` : `16 px` par `1 sample`
- `T16/1` : grille tertiaire tous les `1 sample`
- `S192/12 e` : grille secondaire tous les `12 samples`, étiquetée en
  samples
- `P768/48 m` : grille primaire tous les `48 samples`, étiquetée en
  millisecondes

Dans cet exemple, les graduations secondaires sont donc numérotées :

```text
0, 12, 24, 36, ...
```

et les graduations primaires :

```text
0, 1, 2, 3, ...
```

en millisecondes.

## Subprimary de rendu

Certains backends de rendu peuvent avoir besoin de subdiviser une division
primaire trop large, sans changer pour autant la définition logique du zoom.

On introduit alors la notion de `subprimary` :

- une `subprimary` est une subdivision **de rendu** d'une division primaire ;
- elle n'introduit aucun nouveau niveau de grille logique ;
- elle ne change ni `T`, ni `S`, ni `P` dans le tableau canonique du zoom.

Pour un niveau de zoom donné :

- si `primaryWidthPx <= primaryWidthLimit`, alors `k = 1` et il n'y a pas de
  `subprimary` au sens pratique ;
- sinon on choisit le plus petit entier `k >= 2` tel que :
  - `primaryWidthPx / k <= primaryWidthLimit`
  - `primaryWidthPx / k` soit un multiple entier de `secondaryWidthPx`

Cela revient à chercher des entiers `k` et `n` tels que :

```text
primaryWidthPx = (k × n) × secondaryWidthPx
```

avec :

```text
subprimaryWidthPx = primaryWidthPx / k = n × secondaryWidthPx
```

Cette contrainte garantit que :

- chaque frontière de `subprimary` tombe exactement sur une frontière
  secondaire ;
- la géométrie reste exacte en pixels ;
- la géométrie reste exacte en samples.

Si aucun `k` satisfaisant cette contrainte n'existe, il faudrait en théorie
descendre à une subdivision exacte plus fine que la secondaire. Dans la table
de zoom actuelle, ce cas ne se produit jamais ; il n'est donc pas traité dans
cette version.

## Tableau initial à `48 kHz`

Le tableau initial le plus fin, déjà décidé, devient :

| Niveau | Z | T | S/T | S | P/S | P |
|--------|---|---|-----|---|-----|---|
| 0 | `16/1` | `16/1` | `12` | `192/12 e` | `4` | `768/48 m` |

La même ligne peut s'écrire de façon compacte :

```text
0 : Z16/1 ; T16/1 ; S192/12 e ; P768/48 m
```

Les niveaux suivants à `48 kHz` peuvent ensuite être dérivés dans la même
forme :

| Niveau | Z | T | S/T | S | P/S | P |
|--------|---|---|-----|---|-----|---|
| 1 | `12/1` | `12/1` | `12` | `144/12 e` | `4` | `576/48 m` |
| 2 | `8/1` | `8/1` | `12` | `96/12 e` | `4` | `384/48 m` |
| 3 | `4/1` | `8/2` | `6` | `48/12 e` | `4` | `192/48 m` |
| 4 | `3/1` | `9/3` | `4` | `36/12 e` | `4` | `144/48 m` |
| 5 | `1/1` | `8/8` | `6` | `48/48 m` | `10` | `480/480 c` |
| 6 | `1/2` | `8/16` | `6` | `48/96 m` | `5` | `240/480 c` |
| 7 | `1/3` | `8/24` | `4` | `32/96 m` | `5` | `160/480 c` |
| 8 | `1/4` | `8/32` | `3` | `24/96 m` | `5` | `120/480 c` |
| 9 | `1/6` | `8/48` | `10` | `80/480 c` | `10` | `800/4800 d` |
| 10 | `1/8` | `10/80` | `6` | `60/480 c` | `10` | `600/4800 d` |
| 11 | `1/12` | `10/120` | `4` | `40/480 c` | `10` | `400/4800 d` |
| 12 | `1/16` | `10/160` | `3` | `30/480 c` | `10` | `300/4800 d` |
| 13 | `1/24` | `10/240` | `2` | `20/480 c` | `10` | `200/4800 d` |
| 14 | `1/32` | `10/320` | `15` | `150/4800 d` | `10` | `1500/48000 s` |
| 15 | `1/48` | `10/480` | `10` | `100/4800 d` | `10` | `1000/48000 s` |
| 16 | `1/60` | `8/480` | `10` | `80/4800 d` | `10` | `800/48000 s` |
| 17 | `1/80` | `10/800` | `6` | `60/4800 d` | `10` | `600/48000 s` |
| 18 | `1/96` | `10/960` | `5` | `50/4800 d` | `10` | `500/48000 s` |
| 19 | `1/120` | `8/960` | `5` | `40/4800 d` | `10` | `400/48000 s` |
| 20 | `1/160` | `10/1600` | `3` | `30/4800 d` | `10` | `300/48000 s` |
| 21 | `1/240` | `10/2400` | `2` | `20/4800 d` | `10` | `200/48000 s` |
| 22 | `1/480` | `10/4800` | `10` | `100/48000 s` | `60` | `6000/2880000 M` |
| 23 | `1/720` | `10/7200` | `20` | `200/144000 s` | `20` | `4000/2880000 M` |
| 24 | `1/960` | `10/9600` | `15` | `150/144000 s` | `20` | `3000/2880000 M` |
| 25 | `1/1200` | `8/9600` | `15` | `120/144000 s` | `20` | `2400/2880000 M` |
| 26 | `1/1440` | `10/14400` | `10` | `100/144000 s` | `20` | `2000/2880000 M` |
| 27 | `1/1800` | `8/14400` | `10` | `80/144000 s` | `20` | `1600/2880000 M` |
| 28 | `1/2400` | `10/24000` | `6` | `60/144000 s` | `20` | `1200/2880000 M` |
| 29 | `1/2880` | `10/28800` | `5` | `50/144000 s` | `20` | `1000/2880000 M` |
| 30 | `1/3600` | `8/28800` | `5` | `40/144000 s` | `20` | `800/2880000 M` |
| 31 | `1/4800` | `10/48000` | `3` | `30/144000 s` | `20` | `600/2880000 M` |
| 32 | `1/7200` | `10/72000` | `2` | `20/144000 s` | `20` | `400/2880000 M` |

Cette suite montre déjà deux choses :

- la progression des niveaux peut être plus fine qu'une simple suite en
  facteur `2` ;
- le pivot exact `1 pixel = 1 sample` reste utilisable, mais dans une famille
  où la primaire bascule de `1 ms` à `10 ms`.

## Monotonie des familles

Quand on zoome vers une vue plus grossière, les familles d'unités ne doivent
pas revenir à une famille plus fine.

Autrement dit :

- `S` et `P` peuvent rester dans la même famille ;
- `S` et `P` peuvent basculer vers une famille plus grossière ;
- `S` et `P` ne doivent pas rebasculeer ensuite vers une famille plus fine.

Exemple à `48 kHz` :

- après la bascule de `m -> c` et `c -> d`,
- les niveaux suivants doivent rester au moins dans cette granularité.

Cette monotonie évite :

- des tableaux difficiles à lire ;
- des retours UX incohérents d'un niveau à l'autre ;
- des changements de labels non prévisibles pendant le zoom.

## Tableau initial à `44.1 kHz`

À `44.1 kHz`, le tableau doit garder la même structure, mais avec une règle UX
différente sous `10 ms`.

La contrainte structurante devient :

| Domaine | Règle |
|---------|-------|
| `>= 10 ms` | labels UX temporels (`ms`) autorisés |
| `< 10 ms` | labels UX exprimés en numéros d'échantillons |

Donc, à `44.1 kHz`, le tableau doit pouvoir faire apparaître explicitement la
bascule des labels :

| Niveau | Z | T | S/T | S | P/S | P |
|--------|---|---|-----|---|-----|---|
| niveau fin sous `10 ms` | `N/1` ou `1/N` | division exacte en samples | ratio entier | multiple entier de samples en `e` | ratio entier | multiple entier de samples en `e` |
| niveau plus grossier au-dessus de `10 ms` | relation exacte conservée | subdivision exacte | ratio entier | subdivision exacte en `ms` | ratio entier | subdivision exacte en `ms` |

## Conséquence architecturale

Le système actuel basé sur des largeurs temporelles lisibles mais
fractionnaires n'est plus suffisant.

Le futur système devra être reconstruit autour de :

- niveaux de zoom discrets exacts ;
- projection sample/pixel entière ;
- grille dérivée de ces niveaux exacts ;
- labels adaptés à la `sampleRate`.

## Questions suivantes

Les décisions suivantes restent à prendre :

1. quelle est la suite complète des niveaux exacts autour du pivot `1 px/sample` ;
2. comment dériver la grille primaire / secondaire / tertiaire pour chaque
   niveau ;
3. à partir de quel niveau exact la hiérarchie `1 sample / 0.25 ms / 1 ms`
   cesse d'être lisible à `48 kHz` ;
4. quelle famille exacte de lignes retenir à `44.1 kHz` sous `10 ms` ;
5. jusqu'où prolonger la partie `samples/pixel` du tableau.
