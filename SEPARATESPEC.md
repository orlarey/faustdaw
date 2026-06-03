# Spécification de la Séparation Son / Silence

## Problème

Nous voulons introduire une future fonction `separate` capable de découper un
clip audio en une suite contiguë de sous-clips alternant :

- sous-clips sonores ;
- sous-clips silencieux.

Avant d'exécuter réellement cette séparation, il faut que l'utilisateur puisse
voir clairement où l'algorithme placera les frontières.

Le rendu visuel doit donc exposer la segmentation implicite du clip, sans
alourdir fortement l'affichage de la waveform.

## But

Nous voulons définir une représentation dérivée d'un clip qui permette :

- de classifier chaque portion du clip comme `Sound` ou `Silence` ;
- de regrouper ces portions en segments contigus ;
- de rendre visibles les frontières entre segments ;
- et, plus tard, d'utiliser exactement ces mêmes frontières pour la commande
  `separate`.

## Première décision

La séparation est une **donnée dérivée de la waveform**, pas une donnée
stockée directement dans le clip.

Autrement dit :

- la ressource audio reste inchangée ;
- le clip reste inchangé ;
- la segmentation son/silence est calculée à partir de la pyramide de waveform.

Cette segmentation est donc :

- calculable à la demande ;
- partageable entre plusieurs vues ;
- cohérente avec le futur comportement de `separate`.

## Deuxième décision

La classification se fait à partir des couples `min/max` déjà présents dans la
pyramide de waveform.

L'idée générale est :

- un bucket est considéré comme sonore si son couple `min/max` montre une
  activité suffisante ;
- un bucket est considéré comme silencieux sinon.

Le détail exact du critère numérique n'est pas figé dans cette spécification.
En revanche, le résultat attendu l'est :

- deux buckets voisins doivent être classés de manière stable ;
- l'algorithme ne doit pas introduire de frontières arbitraires au milieu
  d'une zone visiblement sonore ;
- l'algorithme ne doit pas laisser fusionner sans raison deux zones sonores
  séparées par un silence visible.

## Troisième décision

Pour la prévisualisation, on ne cherche pas à construire explicitement une
suite de segments `Sound` / `Silence`.

On définit :

- une mesure scalaire `b[k]` par bucket ;
- un seuil `s` ;
- une longueur minimale `l`.

Une plage `i..j` est considérée comme un silence si :

- pour tout `k` tel que `i <= k <= j`, on a `b[k] < s` ;
- `j - i >= l` ;
- `b[i - 1] > s` si `i - 1` existe ;
- `b[j + 1] > s` si `j + 1` existe.

Autrement dit :

- la plage `i..j` est une plage silencieuse maximale ;
- elle est entourée de son de part et d'autre quand ces voisins existent.

Cette définition suffit pour déterminer les frontières utiles au rendu.

## Quatrième décision

La prévisualisation utilisateur des séparations se fait par de **fins traits
verticaux sur toute la hauteur du clip**, placés exactement aux frontières
entre segment sonore et segment silencieux.

Cette visualisation doit rester minimale :

- pas de fond coloré supplémentaire ;
- pas de label ;
- pas de surcharge visuelle permanente.

Le trait seul suffit, car :

- si l'utilisateur voit une waveform avant et après, avec un vide apparent
  entre deux traits, il comprend qu'il s'agit d'un silence ;
- si l'utilisateur voit un trait séparant deux formes d'onde visiblement
  continues, il comprend qu'il s'agit d'un défaut de classification.

Autrement dit, la frontière doit être **auto-vérifiable visuellement**.

## Cinquième décision

Si une plage silencieuse maximale `i..j` est détectée, il suffit de marquer
ses deux bornes :

- le bucket `i` ;
- le bucket `j`.

Le rendu des frontières est encodé dans la donnée de waveform de manière
simple : une frontière est représentée par une **inversion du couple
`min/max`**.

Autrement dit :

- on inverse `min/max` au bucket `i` ;
- on inverse `min/max` au bucket `j`.

Cette inversion ne décrit pas un son :

- elle code explicitement un trait de séparation ;
- elle suffit au rendu pour dessiner les deux frontières du silence.

Cette convention a un avantage important :

- elle permet de marquer une frontière sans structure auxiliaire lourde ;
- elle reste compatible avec un rendu raster très simple ;
- elle rend la frontière détectable par le code de dessin lui-même.

## Sixième décision

L'inversion `min/max` n'est pas une altération sémantique de la ressource
audio. C'est un **marquage dérivé de rendu**.

Autrement dit :

- la pyramide audio reste la source physique de vérité ;
- la vue de séparation peut produire une variante dérivée où certaines
  colonnes sont marquées comme frontières ;
- la ressource audio et le clip n'enregistrent pas cette inversion comme une
  donnée source.

## Septième décision

La fonction future `separate` devra utiliser exactement les mêmes frontières
que celles rendues visuellement.

Autrement dit :

- on ne veut pas un algorithme de preview ;
- puis un autre algorithme de découpage.

On veut :

```text
classification -> segments -> frontières
```

et :

- le rendu lit ces frontières ;
- `separate` lit ces mêmes frontières.

Ainsi, la preview visuelle est une représentation fidèle de l'action future.

## Huitième décision

Les invariants suivants doivent rester vrais :

- une plage silencieuse marquée est une plage maximale au sens de la troisième
  décision ;
- toute plage silencieuse marquée produit exactement deux frontières ;
- un trait visible au milieu de deux zones clairement sonores indique un bug ;
- l'absence de traits entourant un silence visible indique un bug.

## Neuvième décision

La bonne architecture est la suivante :

```text
WaveformPyramid
  -> calcul de b[k]
  -> détection des plages silencieuses maximales
  -> marquage des bornes i et j
  -> encodage visuel des frontières
  -> rendu des traits verticaux
```

Puis, plus tard :

```text
plages silencieuses détectées
  -> commande separate
  -> création des sous-clips
```

Ainsi :

- la preview visuelle ;
- et l'action future `separate`

reposeront sur la même détection des silences.
