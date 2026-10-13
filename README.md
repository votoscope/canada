# canada

Modèle de projection des élections fédérales canadiennes (Votoscope).

## Organisation

| Dossier | Contenu |
|---|---|
| `src/` | Moteur commun : tendance nationale par processus gaussien en log-ratios isométriques, compositions, résumés de simulation. |
| `lib/` | Modèle fédéral : swing par transfert entre partis, cibles régionales tirées des ventilations de sondages, simulation des sièges. |
| `tools/` | Validation (trois transitions : 2015-2019, 2019-2021, 2021-2025) et projection courante (`project_now.mjs`). |
| `ingest/` | Entrées du modèle tirées du dépôt de données `votoscope/data`. |
| `data/` | Entrées et sorties du modèle (JSON). |

## Utilisation

Le dépôt de données `votoscope/data` est cloné à côté (`../data`).

```
npm install
npm run donnees      # ../data/csv -> data/*.json
npm run projection   # projection courante -> data/ca_projection.json, data/ca_dashboard.json
```

Les outils de validation de la couche régionale utilisent des ventilations régionales historiques qui ne sont pas republiées ; ils les lisent dans `../data/prive/` lorsqu'il existe.

## Licence

GNU GPL v3 (`LICENSE`).
