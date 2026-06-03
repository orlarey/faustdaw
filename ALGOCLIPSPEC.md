# Spécification clip audio algorithmique

## Cadrage

Un *clip audio algorithmique* est un clip dont le contenu sonore est généré à la volée par un programme Faust qui s'exécute pour une durée fixée. Pendant cette durée, les paramètres du DSP évoluent en suivant une trajectoire dans l'espace des configurations — trajectoire composée par l'utilisateur en plaçant des **waypoints** dans le temps.

C'est l'extension temporelle naturelle de la calque preset-ui : la calque est l'éditeur d'une trajectoire instantanée (le centre glisse dans le plan 2D) ; un clip algorithmique est l'éditeur d'une trajectoire **paramétrée par le temps**.

## Définition

Un clip algorithmique est défini par :

- Un **programme DSP** (code source Faust, identifié par son `uiHash`).
- Une **durée** (millisecondes).
- Une **séquence de waypoints** $W = [(t_0, c_0), (t_1, c_1), \dots, (t_n, c_n)]$ avec $0 \leq t_0 < t_1 < \dots < t_n \leq \text{durée}$, chaque $c_i$ étant une configuration complète des paramètres.
- Un **niveau d'interpolation** $\in \{0, 1\}$ déterminant la transition entre waypoints.

À chaque instant $t$ du clip, la **configuration jouée** $c(t)$ est calculée par interpolation entre les waypoints encadrant $t$.

## Interpolation entre waypoints

Deux modes, parallèles aux transitions dynamiques de PRESETSPEC :

- **Niveau 0 (linéaire composante par composante)** : $c(t) = (1-\alpha)\,c_i + \alpha\,c_{i+1}$ avec $\alpha = (t - t_i)/(t_{i+1} - t_i)$.
- **Niveau 1 (Shepard via la calque)** : la projection $\pi(c)$ glisse linéairement dans le plan entre $\pi(c_i)$ et $\pi(c_{i+1})$, puis $c(t) = \psi(\pi(t))$. Le chemin dans l'espace des configurations passe alors par les zones d'influence des presets voisins, produisant des évolutions non-linéaires riches.

## Waypoints et bibliothèque de presets

Un waypoint stocke la **valeur** de sa configuration, pas une référence par identité à un preset de la bibliothèque (règle 4 d'UNDOREDOSPEC). Une suppression ultérieure du preset source n'invalide pas le waypoint ; juste son label informatif disparaît.

Symétriquement, éditer un preset déjà utilisé comme waypoint ne propage pas automatiquement la nouvelle valeur dans le clip — le clip détient sa propre copie. Pour propager, l'utilisateur replace explicitement le waypoint depuis la bibliothèque.

## Relation à la trajectoire utilisateur (PRESETSPEC)

Une session d'utilisation de la calque produit une **trajectoire** (log append-only des commits de geste). Un clip algorithmique est la **réification éditable** d'une telle trajectoire :

- Trajectoire = enregistrement passif de ce que l'utilisateur a fait.
- Clip algorithmique = trajectoire conçue, modifiable, exécutable de manière reproductible.

Conséquence pratique : un fragment du log peut être **transformé en clip** ($t_0$ et $t_n$ délimitent un intervalle, les commits y deviennent les waypoints initiaux).

## Cas particulier : le clip en boucle

Le mode boucle de la calque (cycle d'une sélection à TL fixe) s'exprime comme un clip algorithmique : durée = TL, waypoints uniformément espacés sur la sélection, interpolation niveau 1, lecture en boucle. Le clip algorithmique généralise le mode boucle.

## Frontières

**Dans le scope** :
- Évolution des paramètres au cours du temps via waypoints + interpolation.
- Persistance dans le project document.
- Exécution audio à configuration variable.

**Hors du scope** :
- Évolution du **code DSP** au cours du temps (un clip = un seul code).
- Évolution de la **signature paramètres** au cours du temps. Si l'UI change après création (édit de code rendant le `uiHash` invalide), le clip est invalide jusqu'à intervention manuelle.

## Hors-scope de la spec

- Modèle de rendu (temps réel à la lecture vs bounce offline préliminaire) — choix d'implémentation.
- Édition UI (drag-and-drop d'un preset sur la timeline, marqueurs visuels, scrub) — document de design séparé une fois le modèle stable.
- Quantization des waypoints (grille / mesure / libre) — choix utilisateur exposé comme préférence.
- Stockage des configurations (compactage, dedup, par valeur vs par hash workspace) — détail d'implémentation.
- Modèle d'undo des éditions de waypoint — couvert par UNDOREDOSPEC, à instancier comme un scope par clip.
