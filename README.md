# JardinDevis

Application web pour les jardiniers indépendants et les petites entreprises de paysagisme en France : créez, imprimez et partagez des devis professionnels depuis un téléphone, une tablette ou un ordinateur.

## Démarrer

Aucune installation : ouvrez simplement `index.html` dans un navigateur (ou via l'aperçu de l'app). L'application fonctionne entièrement hors ligne.

## Où sont enregistrées vos données ?

Toutes les données (profil de l'entreprise, clients, devis, logo) sont stockées **localement sur l'appareil**, dans le stockage du navigateur (localStorage).

- **Rien n'est envoyé sur Internet** : aucun serveur, aucun compte, aucune collecte de données personnelles.
- Les données restent sur l'appareil et le navigateur utilisés. Elles ne sont pas synchronisées entre plusieurs appareils.
- Vider les données du navigateur ou désinstaller l'application efface les devis.

Pour ne rien perdre, utilisez la section **Sauvegarde** de la page « Mon entreprise » :
- **Télécharger une sauvegarde** : crée un fichier JSON contenant tous vos devis et votre profil.
- **Restaurer une sauvegarde** : recharge un fichier de sauvegarde (remplace les données actuelles).

Si vous souhaitez un jour une synchronisation multi-appareils, il faudrait ajouter un serveur ou un service en ligne (par exemple Firebase, Supabase ou un petit serveur auto-hébergé). Ce n'est pas nécessaire pour une utilisation sur un seul appareil.

## Génération du PDF

Le bouton « Télécharger PDF » crée un vrai fichier PDF (`Devis-DEV-2025-001.pdf`) directement dans le navigateur :

- **Sur iPhone/Android** : la fiche de partage native s'ouvre — enregistrez dans « Fichiers », envoyez par e-mail, WhatsApp ou AirDrop.
- **Sur ordinateur** : le fichier est téléchargé automatiquement.
- Le bouton « Imprimer » reste disponible : il ouvre la fenêtre d'impression, où l'on peut aussi choisir « Enregistrer au format PDF ».

Pour générer le fichier, l'application charge une petite bibliothèque gratuite (jsPDF) depuis un serveur public (cdnjs) : internet est donc nécessaire lors de l'export. Hors connexion, un message propose automatiquement la solution de secours « Imprimer → Enregistrer au format PDF », qui fonctionne sans rien ajouter.

## Régime de TVA

Le taux de TVA n'est jamais appliqué automatiquement : il dépend du régime sélectionné pour chaque devis.

- **Franchise en base de TVA** : 0 % de TVA, avec la mention légale « TVA non applicable, art. 293 B du CGI » sur le devis.
- **TVA réduite 10 %** ou **normale 20 %** : total HT, TVA et TTC affichés séparément.
- **Taux personnalisé** : saisissez votre propre taux.

Le régime par défaut se règle dans « Mon entreprise » et peut être changé pour chaque devis.
## Abonnement et paiement

L'accès complet se fait par abonnement : **9,99 €/mois** ou **70 €/an** (soit 5,83 €/mois, environ 42 % d'économie). Deux essais gratuits sont prévus : **1 jour** sur l'offre mensuelle et **3 jours** sur l'offre annuelle, une seule fois chacun par appareil.

Tant que Stripe n'est pas configuré, les essais fonctionnent déjà et le bouton « S'abonner » signale que le paiement n'est pas encore actif.

### Activer le paiement en ligne (Stripe, gratuit à créer)

1. Créez un compte sur [stripe.com](https://stripe.com), puis deux **Payment Links** (Liens de paiement) :
   - **Mensuel** : produit à 9,99 € avec facturation récurrente chaque mois.
   - **Annuel** : produit à 70 € avec facturation récurrente chaque année.
2. Dans chaque lien, réglez « Après le paiement → Rediriger vers votre site » vers :
   - Mensuel : `https://eloicaudy1330-boop.github.io/JardinDevis/?abonnement=mensuel&cle=JARDINDEVIS-2025`
   - Annuel : `https://eloicaudy1330-boop.github.io/JardinDevis/?abonnement=annuel&cle=JARDINDEVIS-2025`
3. Dans `app.js`, collez les deux liens dans `STRIPE_LINK_MENSUEL` et `STRIPE_LINK_ANNUEL`.
4. **Changez la clé secrète** `ABO_SECRET` dans `app.js` ET dans les deux URLs de redirection : elle doit être identique partout, et rester privée. Toute personne connaissant cette clé peut activer l'abonnement sans payer.

L'utilisateur qui paie revient automatiquement sur le site avec son abonnement activé (1 mois ou 12 mois, cumulables avec l'essai en cours). Pour tester vous-même votre site, ouvrez l'un des deux liens d'activation ci-dessus dans le navigateur.

### Limites à connaître (transparence)

- Le contrôle d'abonnement est effectué **dans le navigateur** : un utilisateur averti peut modifier ses données locales ou lire la clé dans le code source. Pour un verrouillage inviolable, il faut un petit serveur qui vérifie les paiements Stripe (par exemple Supabase ou Cloudflare Workers, gratuits jusqu'à un certain usage).
- Les données des devis restent stockées **uniquement sur l'appareil de chaque utilisateur** ; elles ne sont jamais envoyées sur Internet, ni lors du paiement (qui est géré par Stripe, et non par ce site).