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

Le bouton « Télécharger PDF » ouvre la fenêtre d'impression du navigateur : choisissez la destination « Enregistrer au format PDF ». C'est gratuit, sans limite, et fonctionne sur iPhone, Android et ordinateur. Aucune bibliothèque payante n'est nécessaire.

## Régime de TVA

Le taux de TVA n'est jamais appliqué automatiquement : il dépend du régime sélectionné pour chaque devis.

- **Franchise en base de TVA** : 0 % de TVA, avec la mention légale « TVA non applicable, art. 293 B du CGI » sur le devis.
- **TVA réduite 10 %** ou **normale 20 %** : total HT, TVA et TTC affichés séparément.
- **Taux personnalisé** : saisissez votre propre taux.

Le régime par défaut se règle dans « Mon entreprise » et peut être changé pour chaque devis.