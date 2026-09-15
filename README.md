# Paraphe

Paraphe est une application web mobile pour transformer des PDF vierges en formulaires à remplir et signer.

Le parcours est volontairement simple :

1. déposer un PDF et choisir l’adresse email de destination ;
2. placer les zones de texte et de signature sur les pages ;
3. sélectionner le document dans la bibliothèque ;
4. remplir un formulaire adapté au téléphone et signer avec le doigt ;
5. générer une nouvelle copie PDF et contrôler son aperçu final ;
6. confirmer l’envoi par email ou revenir corriger le formulaire.

Les originaux sont conservés séparément des documents finalisés.

## Lancer le projet

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
cp .env.example .env
npm run dev
```

Ouvrez ensuite [http://127.0.0.1:4173](http://127.0.0.1:4173).

Pour vérifier le projet :

```bash
npm run check
npm test
```

Le test couvre automatiquement le dépôt d’un PDF, l’enregistrement des zones, la signature, l’aperçu du PDF final et son téléchargement.

## Activer l’envoi par email

Renseignez ces valeurs dans `.env` avec les identifiants SMTP de votre fournisseur :

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=utilisateur
SMTP_PASS=mot-de-passe-application
MAIL_FROM=Paraphe <documents@example.com>
```

Les valeurs de `.env.example` sont volontairement fictives et ne permettent aucun envoi. Remplacez les cinq valeurs SMTP par celles d’un vrai compte expéditeur, puis redémarrez le serveur. Utilisez de préférence un mot de passe d’application. Si SMTP n’est pas configuré ou si l’envoi échoue, le PDF final reste disponible dans l’étape d’aperçu et au téléchargement.

## Utiliser le site depuis un téléphone

Le téléphone et le Mac doivent être sur le même réseau local. Dans `.env`, utilisez :

```dotenv
HOST=0.0.0.0
PORT=4173
```

Relancez le serveur, trouvez l’adresse IP locale du Mac dans les réglages réseau, puis ouvrez `http://ADRESSE-DU-MAC:4173` sur le téléphone.

Cette ouverture rend le service visible aux autres appareils du même réseau. Utilisez uniquement un réseau de confiance. Avant toute mise en ligne sur Internet, ajoutez au minimum une authentification, HTTPS, des sauvegardes et une règle de suppression des documents.

## Version de production

```bash
npm run build
npm start
```

Les données sont enregistrées ici :

- `data/paraphe.sqlite` : modèles, zones et historique des générations ;
- `data/templates/` : PDF vierges ;
- `data/completed/` : PDF remplis et signés.

## Limites à connaître

- Taille maximale d’un PDF : 10 Mo.
- Les PDF protégés par mot de passe ne sont pas acceptés.
- La signature dessinée correspond à une signature électronique simple. Pour un usage réglementé ou à forte valeur probante, il faut compléter le système avec vérification d’identité, consentement, horodatage et journal de preuve adaptés au cadre applicable.
