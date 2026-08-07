# TheList

Une extension Chrome pour garder ce qu'on veut acheter **et** ce qu'on veut relire.
Un raccourci sur n'importe quelle page : un produit, un panier entier, ou un
passage de texte.

## Philosophie

**Aucune règle par site.** Il aurait été facile d'écrire un adaptateur Amazon, un
adaptateur Apple, et de recommencer à chaque refonte de thème. L'extraction est
volontairement structurelle : on lit d'abord ce que le marchand **déclare**
(JSON-LD `schema.org/Product`, microdonnées, OpenGraph), et seulement à défaut on
raisonne sur la structure de la page — jamais sur des noms de classes.

**Le produit est un bloc, pas une collection de champs.** Titre, prix et image
sortent du *même* conteneur. C'est ce qui empêche la chimère classique : la photo
d'un article avec le prix d'un autre.

**Rien ne se devine en silence.** Une image qui ne charge pas affiche son URL, un
total qui exclut des articles le dit, un raccourci non attribué s'affiche comme
tel. Un échec muet coûte plus cher qu'un échec bruyant.

**Le moins d'interface possible.** Une grille d'images, une bande de 40 px. Ce qui
n'aide pas à retrouver un objet n'a pas sa place à l'écran.

## Fonctionnalités

| | |
|---|---|
| `⌥A` | Ajoute le produit de la page. Sur une page **panier**, ajoute tous les articles — sans les « recommandations pour vous ». |
| `⌥S` | Enregistre le texte sélectionné, avec sa source. Aussi par clic droit. |
| `⌥L` | Ouvre la liste. |

- **Deux sections** : les produits, et les médias (passages enregistrés).
- **Filtre par catégorie** et **total en euros** de ce qui est affiché.
- **Catégorisation** par un modèle via OpenRouter si une clé est configurée,
  sinon par mots-clés. Un échec ne bloque jamais l'ajout.
- **Français / anglais**, changeable à chaud — la locale pilote aussi le format
  des montants.
- **Sons d'interface** synthétisés, coupables d'un clic.

## Ce qui est stocké, et où

| | Emplacement | Synchronisé | Pourquoi |
|---|---|---|---|
| Produits | `storage.sync` | oui | Petits : URL, titre, prix, URL d'image. |
| Passages | `storage.local` | non | `sync` plafonne à 100 Ko au total ; un texte long le ferait exploser. |

Rien n'est envoyé nulle part, à une exception près : si une clé OpenRouter est
configurée, le titre et la marque du produit partent au modèle pour être classés.
Sans clé, l'extension fonctionne entièrement hors ligne.

## Installation

`chrome://extensions` → mode développeur → « Charger l'extension non empaquetée »
→ choisir ce dossier.

Aucune étape de build : tout est de l'ESM chargé tel quel par le navigateur.

## Dépendances

Deux bibliothèques, vendorées dans `src/vendor/` avec leur licence, aucune
dépendance transitive :

- [i18next](https://www.i18next.com) (MIT) — traductions.
- [cuelume](https://github.com/Danilaa1/cuelume) (MIT) — sons d'interface,
  synthétisés en Web Audio, aucun fichier audio embarqué.

L'extraction, elle, n'utilise que des API du navigateur.

## Structure

```
manifest.json
src/
  background.js   service worker : ajout, menus, raccourcis
  extract.js      lecture d'une page produit (injecté à la demande)
  categorize.js   taxonomie fermée, modèle + repli par mots-clés
  store.js        produits (storage.sync)
  media.js        passages (storage.local)
  toast.js        retour visuel, injecté dans la page
  i18n.js         chargement des langues
  wishlist.*      la page de la liste
```
