import { registerTranslations, type Language } from './i18n';
// Authored UI translations. Each row: English | Spanish | French | German | Indonesian | Japanese.
const rows = `
Local machine|Equipo local|Machine locale|Lokaler Computer|Komputer lokal|ローカルマシン
Windows · local workflows|Windows · flujos locales|Windows · travail local|Windows · lokale Abläufe|Windows · alur kerja lokal|Windows · ローカル作業
Ready|Listo|Prêt|Bereit|Siap|準備完了
Tasks and queue|Tareas y cola|Tâches et file d’attente|Aufgaben und Warteschlange|Tugas dan antrean|タスクとキュー
Mark read|Marcar como leído|Marquer comme lu|Als gelesen markieren|Tandai dibaca|既読にする
Mark unread|Marcar como no leído|Marquer comme non lu|Als ungelesen markieren|Tandai belum dibaca|未読にする
First unread result|Primer resultado no leído|Premier résultat non lu|Erstes ungelesenes Ergebnis|Hasil pertama yang belum dibaca|最初の未読結果
Export chat|Exportar chat|Exporter la conversation|Chat exportieren|Ekspor chat|チャットをエクスポート
What are we building?|¿Qué vamos a crear?|Que construisons-nous ?|Was entwickeln wir?|Apa yang akan kita buat?|何を作りましょうか？
Ask Grok to build, explore, or fix something…|Pide a Grok que cree, explore o arregle algo…|Demandez à Grok de créer, explorer ou corriger…|Bitte Grok, etwas zu entwickeln, zu erkunden oder zu reparieren…|Minta Grok membuat, menjelajahi, atau memperbaiki sesuatu…|Grokに作成、調査、修正を依頼…
Permissions apply.|Se aplican los permisos.|Les autorisations s’appliquent.|Berechtigungen gelten.|Izin tetap berlaku.|権限設定が適用されます。
Windows OS sandbox unavailable.|El aislamiento de Windows no está disponible.|Le bac à sable Windows n’est pas disponible.|Windows-Sandbox nicht verfügbar.|Sandbox OS Windows tidak tersedia.|WindowsのOSサンドボックスは利用できません。
Task → test → review|Tarea → prueba → revisión|Tâche → test → vérification|Aufgabe → Test → Prüfung|Tugas → uji → tinjau|タスク → テスト → レビュー
Archived chats|Chats archivados|Conversations archivées|Archivierte Chats|Chat yang diarsipkan|アーカイブ済みチャット
Connect to refresh model choices|Conectar para actualizar modelos|Se connecter pour actualiser les modèles|Verbinden, um die Modellauswahl zu aktualisieren|Hubungkan untuk memperbarui pilihan model|接続してモデルの選択肢を更新
Settings|Configuración|Paramètres|Einstellungen|Pengaturan|設定
General|General|Général|Allgemein|Umum|一般
Appearance|Apariencia|Apparence|Darstellung|Tampilan|外観
Models & permissions|Modelos y permisos|Modèles et autorisations|Modelle und Berechtigungen|Model dan izin|モデルと権限
Account|Cuenta|Compte|Konto|Akun|アカウント
Integrations|Integraciones|Intégrations|Integrationen|Integrasi|連携
Configuration|Configuración avanzada|Configuration|Konfiguration|Konfigurasi|構成
Projects & sessions|Proyectos y sesiones|Projets et sessions|Projekte und Sitzungen|Proyek dan sesi|プロジェクトとセッション
Keyboard shortcuts|Atajos de teclado|Raccourcis clavier|Tastenkürzel|Pintasan keyboard|キーボードショートカット
Storage & diagnostics|Almacenamiento y diagnóstico|Stockage et diagnostic|Speicher und Diagnose|Penyimpanan dan diagnostik|ストレージと診断
Updates|Actualizaciones|Mises à jour|Updates|Pembaruan|更新
Automations & PR watches|Automatizaciones y seguimiento de PR|Automatisations et suivi des PR|Automatisierungen und PR-Beobachtung|Otomasi dan pemantauan PR|自動化とPRの監視
Remote access|Acceso remoto|Accès à distance|Fernzugriff|Akses jarak jauh|リモートアクセス
Providers|Proveedores|Fournisseurs|Anbieter|Penyedia|プロバイダー
Done|Listo|Terminé|Fertig|Selesai|完了
Close settings|Cerrar configuración|Fermer les paramètres|Einstellungen schließen|Tutup pengaturan|設定を閉じる
New chat|Nuevo chat|Nouvelle conversation|Neuer Chat|Chat baru|新しいチャット
Open project|Abrir proyecto|Ouvrir un projet|Projekt öffnen|Buka proyek|プロジェクトを開く
Projects|Proyectos|Projets|Projekte|Proyek|プロジェクト
Project|Proyecto|Projet|Projekt|Proyek|プロジェクト
Chats|Chats|Conversations|Chats|Chat|チャット
Search|Buscar|Rechercher|Suchen|Cari|検索
Search chats|Buscar chats|Rechercher des conversations|Chats durchsuchen|Cari chat|チャットを検索
Files|Archivos|Fichiers|Dateien|Berkas|ファイル
Changes|Cambios|Modifications|Änderungen|Perubahan|変更
Terminal|Terminal|Terminal|Terminal|Terminal|ターミナル
Media|Multimedia|Médias|Medien|Media|メディア
Tasks|Tareas|Tâches|Aufgaben|Tugas|タスク
Archive|Archivar|Archiver|Archivieren|Arsipkan|アーカイブ
Archived|Archivados|Archivées|Archiviert|Diarsipkan|アーカイブ済み
Restore|Restaurar|Restaurer|Wiederherstellen|Pulihkan|復元
Rename|Renombrar|Renommer|Umbenennen|Ganti nama|名前を変更
Remove|Eliminar|Retirer|Entfernen|Hapus|削除
Cancel|Cancelar|Annuler|Abbrechen|Batal|キャンセル
Save|Guardar|Enregistrer|Speichern|Simpan|保存
Edit|Editar|Modifier|Bearbeiten|Edit|編集
Refresh|Actualizar|Actualiser|Aktualisieren|Segarkan|更新
Connect|Conectar|Connecter|Verbinden|Hubungkan|接続
Disconnect|Desconectar|Déconnecter|Trennen|Putuskan|切断
Stop turn|Detener turno|Arrêter le tour|Durchlauf stoppen|Hentikan giliran|ターンを停止
Send|Enviar|Envoyer|Senden|Kirim|送信
Attach files|Adjuntar archivos|Joindre des fichiers|Dateien anhängen|Lampirkan berkas|ファイルを添付
You|Tú|Vous|Du|Anda|あなた
Reasoning|Razonamiento|Raisonnement|Überlegungen|Penalaran|推論
Interface language|Idioma de la interfaz|Langue de l’interface|Oberflächensprache|Bahasa antarmuka|表示言語
Follow system theme|Seguir el tema del sistema|Suivre le thème du système|Systemdesign verwenden|Ikuti tema sistem|システムのテーマに従う
Background theme|Tema de fondo|Thème d’arrière-plan|Hintergrunddesign|Tema latar|背景テーマ
Dark|Oscuro|Sombre|Dunkel|Gelap|ダーク
Light|Claro|Clair|Hell|Terang|ライト
Accent color|Color de acento|Couleur d’accent|Akzentfarbe|Warna aksen|アクセントカラー
green|verde|vert|grün|hijau|緑
blue|azul|bleu|blau|biru|青
purple|morado|violet|violett|ungu|紫
amber|ámbar|ambre|bernstein|kuning amber|琥珀色
Interface font|Fuente de la interfaz|Police de l’interface|Oberflächenschrift|Font antarmuka|表示フォント
Terminal font|Fuente del terminal|Police du terminal|Terminalschrift|Font terminal|ターミナルのフォント
System|Sistema|Système|System|Sistem|システム
Layout density|Densidad de diseño|Densité de l’affichage|Layoutdichte|Kepadatan tata letak|表示密度
Comfortable|Cómodo|Confortable|Großzügig|Nyaman|標準
Compact|Compacto|Compact|Kompakt|Ringkas|コンパクト
Motion|Movimiento|Animations|Bewegung|Animasi|アニメーション
Follow system|Seguir el sistema|Suivre le système|Systemeinstellung|Ikuti sistem|システム設定に従う
Reduce motion|Reducir movimiento|Réduire les animations|Bewegung reduzieren|Kurangi animasi|動きを減らす
UI text size (%)|Tamaño del texto (%)|Taille du texte (%)|Textgröße (%)|Ukuran teks (%)|UIテキストサイズ (%)
Log and terminal font size (px)|Tamaño de fuente del registro y terminal (px)|Taille du texte des journaux et du terminal (px)|Protokoll- und Terminalschriftgröße (px)|Ukuran font log dan terminal (px)|ログとターミナルの文字サイズ (px)
Save appearance|Guardar apariencia|Enregistrer l’apparence|Darstellung speichern|Simpan tampilan|外観を保存
Reset appearance fields|Restablecer apariencia|Réinitialiser l’apparence|Darstellung zurücksetzen|Atur ulang tampilan|外観をリセット
Appearance saved.|Apariencia guardada.|Apparence enregistrée.|Darstellung gespeichert.|Tampilan disimpan.|外観を保存しました。
Scheduled automations|Automatizaciones programadas|Automatisations planifiées|Geplante Automatisierungen|Otomasi terjadwal|スケジュール自動化
Name|Nombre|Nom|Name|Nama|名前
Run in|Ejecutar en|Exécuter dans|Ausführen in|Jalankan di|実行先
New chat for each run|Nuevo chat por ejecución|Nouvelle conversation à chaque exécution|Neuer Chat je Ausführung|Chat baru setiap eksekusi|実行ごとに新しいチャット
Provider profile|Perfil de proveedor|Profil fournisseur|Anbieterprofil|Profil penyedia|プロバイダープロファイル
Grok account / default|Cuenta de Grok / predeterminado|Compte Grok / défaut|Grok-Konto / Standard|Akun Grok / default|Grokアカウント / 既定
Model ID (optional)|ID del modelo (opcional)|ID du modèle (facultatif)|Modell-ID (optional)|ID model (opsional)|モデルID（任意）
Use the chat or provider default|Usar el predeterminado del chat o proveedor|Utiliser le modèle du chat ou du fournisseur|Chat- oder Anbieterstandard verwenden|Gunakan default chat atau penyedia|チャットまたはプロバイダーの既定値を使用
Schedule|Programación|Planification|Zeitplan|Jadwal|スケジュール
Interval|Intervalo|Intervalle|Intervall|Interval|間隔
Daily|Diario|Quotidien|Täglich|Harian|毎日
One time|Una vez|Une fois|Einmalig|Sekali|1回のみ
Every (minutes)|Cada (minutos)|Toutes les (minutes)|Alle (Minuten)|Setiap (menit)|間隔（分）
Date and time (this computer)|Fecha y hora (este equipo)|Date et heure (cet ordinateur)|Datum und Uhrzeit (dieser Computer)|Tanggal dan waktu (komputer ini)|日時（このコンピューター）
Time|Hora|Heure|Uhrzeit|Waktu|時刻
Timezone|Zona horaria|Fuseau horaire|Zeitzone|Zona waktu|タイムゾーン
Prompt|Instrucción|Consigne|Auftrag|Prompt|プロンプト
Enable scheduled execution|Activar ejecución programada|Activer l’exécution planifiée|Geplante Ausführung aktivieren|Aktifkan eksekusi terjadwal|スケジュール実行を有効にする
Save changes|Guardar cambios|Enregistrer les modifications|Änderungen speichern|Simpan perubahan|変更を保存
Save automation|Guardar automatización|Enregistrer l’automatisation|Automatisierung speichern|Simpan otomasi|自動化を保存
Cancel editing|Cancelar edición|Annuler la modification|Bearbeitung abbrechen|Batalkan pengeditan|編集をキャンセル
Enabled|Activado|Activé|Aktiviert|Aktif|有効
Paused|Pausado|En pause|Pausiert|Dijeda|一時停止中
Finished|Finalizado|Terminé|Abgeschlossen|Selesai|終了
Pause|Pausar|Mettre en pause|Pausieren|Jeda|一時停止
Resume|Reanudar|Reprendre|Fortsetzen|Lanjutkan|再開
PR monitoring and continuation|Seguimiento de PR y continuación|Suivi des PR et reprise|PR-Beobachtung und Fortsetzung|Pemantauan PR dan kelanjutan|PRの監視と自動継続
Continue in chat|Continuar en el chat|Continuer dans la conversation|Im Chat fortsetzen|Lanjutkan di chat|継続するチャット
Repository (owner/name)|Repositorio (propietario/nombre)|Dépôt (propriétaire/nom)|Repository (Besitzer/Name)|Repositori (pemilik/nama)|リポジトリ（所有者/名前）
Pull request number|Número de pull request|Numéro de pull request|Pull-Request-Nummer|Nomor pull request|プルリクエスト番号
Continuation prompt|Instrucción de continuación|Consigne de reprise|Fortsetzungsauftrag|Prompt kelanjutan|継続プロンプト
Automatically continue this chat when the PR changes|Continuar este chat al cambiar la PR|Reprendre cette conversation quand la PR change|Diesen Chat bei PR-Änderungen automatisch fortsetzen|Lanjutkan chat ini otomatis saat PR berubah|PRの変更時にこのチャットを自動継続
Watch pull request|Seguir pull request|Suivre la pull request|Pull Request beobachten|Pantau pull request|プルリクエストを監視
Open a project chat to add a pull request watch.|Abre un chat de proyecto para seguir una PR.|Ouvrez une conversation de projet pour suivre une PR.|Öffne einen Projektchat, um eine PR zu beobachten.|Buka chat proyek untuk memantau PR.|プロジェクトのチャットを開いてPRの監視を追加してください。
Check now|Comprobar ahora|Vérifier maintenant|Jetzt prüfen|Periksa sekarang|今すぐ確認
Automatic continuation|Continuación automática|Reprise automatique|Automatische Fortsetzung|Kelanjutan otomatis|自動継続
Monitor only|Solo seguimiento|Suivi uniquement|Nur beobachten|Pantau saja|監視のみ
Pull request changed.|La PR ha cambiado.|La PR a changé.|Pull Request geändert.|Pull request berubah.|プルリクエストが変更されました。
Open chat|Abrir chat|Ouvrir la conversation|Chat öffnen|Buka chat|チャットを開く
Recent runs|Ejecuciones recientes|Exécutions récentes|Letzte Ausführungen|Eksekusi terbaru|最近の実行
Stop run|Detener ejecución|Arrêter l’exécution|Ausführung stoppen|Hentikan eksekusi|実行を停止
running|en ejecución|en cours|läuft|berjalan|実行中
completed|completado|terminé|abgeschlossen|selesai|完了
failed|fallido|échec|fehlgeschlagen|gagal|失敗
interrupted|interrumpido|interrompu|unterbrochen|terinterupsi|中断
Projects to share|Proyectos para compartir|Projets à partager|Freizugebende Projekte|Proyek yang dibagikan|共有するプロジェクト
Local port (0 = automatic)|Puerto local (0 = automático)|Port local (0 = automatique)|Lokaler Port (0 = automatisch)|Port lokal (0 = otomatis)|ローカルポート（0 = 自動）
HTTPS tunnel origin (optional)|Origen del túnel HTTPS (opcional)|Origine du tunnel HTTPS (facultatif)|HTTPS-Tunnel-Ursprung (optional)|Origin tunnel HTTPS (opsional)|HTTPSトンネルのオリジン（任意）
Allow remote prompts and stop requests|Permitir instrucciones y detención remotas|Autoriser les consignes et arrêts à distance|Remote-Aufträge und Stoppanfragen erlauben|Izinkan prompt dan penghentian jarak jauh|リモートからのプロンプトと停止を許可
Start remote access|Iniciar acceso remoto|Démarrer l’accès à distance|Fernzugriff starten|Mulai akses jarak jauh|リモートアクセスを開始
Remote access is running|Acceso remoto activo|Accès à distance actif|Fernzugriff ist aktiv|Akses jarak jauh aktif|リモートアクセスは実行中です
Control enabled|Control activado|Contrôle activé|Steuerung aktiviert|Kontrol aktif|操作が有効
Read only|Solo lectura|Lecture seule|Nur lesen|Hanya baca|読み取り専用
Local address|Dirección local|Adresse locale|Lokale Adresse|Alamat lokal|ローカルアドレス
Remote address|Dirección remota|Adresse distante|Remote-Adresse|Alamat jarak jauh|リモートアドレス
Pairing token|Token de emparejamiento|Jeton d’association|Kopplungstoken|Token pemasangan|ペアリングトークン
Show token|Mostrar token|Afficher le jeton|Token anzeigen|Tampilkan token|トークンを表示
Hide token|Ocultar token|Masquer le jeton|Token ausblenden|Sembunyikan token|トークンを隠す
Stop and revoke access|Detener y revocar acceso|Arrêter et révoquer l’accès|Stoppen und Zugriff widerrufen|Hentikan dan cabut akses|停止してアクセスを取り消す
API and connection details|Detalles de API y conexión|Détails de l’API et de connexion|API- und Verbindungsdetails|Detail API dan koneksi|APIと接続の詳細
Access activity|Actividad de acceso|Activité d’accès|Zugriffsaktivität|Aktivitas akses|アクセス履歴
Provider profiles|Perfiles de proveedores|Profils fournisseurs|Anbieterprofile|Profil penyedia|プロバイダープロファイル
Endpoint preset|Preajuste de endpoint|Préréglage du point d’accès|Endpunktvorlage|Preset endpoint|エンドポイントのプリセット
Custom|Personalizado|Personnalisé|Benutzerdefiniert|Kustom|カスタム
Local server|Servidor local|Serveur local|Lokaler Server|Server lokal|ローカルサーバー
Profile name|Nombre del perfil|Nom du profil|Profilname|Nama profil|プロファイル名
API base URL|URL base de la API|URL de base de l’API|API-Basis-URL|URL dasar API|APIのベースURL
Model routing ID|ID de ruta del modelo|ID de routage du modèle|Modell-Routing-ID|ID perutean model|モデルのルーティングID
API format|Formato de API|Format d’API|API-Format|Format API|API形式
Context window (tokens)|Ventana de contexto (tokens)|Fenêtre de contexte (tokens)|Kontextfenster (Tokens)|Jendela konteks (token)|コンテキストウィンドウ（トークン）
Provider API key|Clave API del proveedor|Clé API du fournisseur|Anbieter-API-Schlüssel|Kunci API penyedia|プロバイダーのAPIキー
Leave blank to retain the current key|Dejar vacío para conservar la clave|Laisser vide pour conserver la clé|Leer lassen, um den Schlüssel zu behalten|Kosongkan untuk mempertahankan kunci|空欄にすると現在のキーを保持
Remember with encrypted storage|Recordar con almacenamiento cifrado|Mémoriser avec stockage chiffré|Verschlüsselt speichern|Ingat dengan penyimpanan terenkripsi|暗号化ストレージに保存
Preview provider configuration|Vista previa de la configuración|Aperçu de la configuration|Anbieterkonfiguration prüfen|Pratinjau konfigurasi penyedia|プロバイダー構成をプレビュー
Save reviewed provider|Guardar proveedor revisado|Enregistrer le fournisseur vérifié|Geprüften Anbieter speichern|Simpan penyedia yang ditinjau|確認したプロバイダーを保存
Encrypted key saved|Clave cifrada guardada|Clé chiffrée enregistrée|Schlüssel verschlüsselt gespeichert|Kunci terenkripsi disimpan|暗号化キーを保存済み
Session-only key|Clave solo para esta sesión|Clé limitée à cette session|Schlüssel nur für diese Sitzung|Kunci hanya untuk sesi ini|このセッションのみのキー
Key required|Se requiere una clave|Clé requise|Schlüssel erforderlich|Kunci diperlukan|キーが必要
Confirm removal|Confirmar eliminación|Confirmer la suppression|Entfernen bestätigen|Konfirmasi penghapusan|削除を確定
Provider for this chat|Proveedor para este chat|Fournisseur de cette conversation|Anbieter für diesen Chat|Penyedia untuk chat ini|このチャットのプロバイダー
Document preview|Vista previa del documento|Aperçu du document|Dokumentvorschau|Pratinjau dokumen|ドキュメントのプレビュー
Refresh preview|Actualizar vista previa|Actualiser l’aperçu|Vorschau aktualisieren|Segarkan pratinjau|プレビューを更新
Loading preview…|Cargando vista previa…|Chargement de l’aperçu…|Vorschau wird geladen…|Memuat pratinjau…|プレビューを読み込み中…
Attached image|Imagen adjunta|Image jointe|Angehängtes Bild|Gambar terlampir|添付画像
Previous page|Página anterior|Page précédente|Vorherige Seite|Halaman sebelumnya|前のページ
Next page|Página siguiente|Page suivante|Nächste Seite|Halaman berikutnya|次のページ
PDF page|Página PDF|Page PDF|PDF-Seite|Halaman PDF|PDFページ
Preview limit reached. Open the original document for all content.|Límite de vista previa alcanzado. Abre el original para ver todo.|Limite de l’aperçu atteinte. Ouvrez l’original pour tout voir.|Vorschaulimit erreicht. Öffne das Original für den gesamten Inhalt.|Batas pratinjau tercapai. Buka dokumen asli untuk seluruh konten.|プレビューの上限に達しました。全内容は元のドキュメントで確認してください。
Website preview|Vista previa web|Aperçu du site|Website-Vorschau|Pratinjau situs|ウェブサイトのプレビュー
Preview URL|URL de vista previa|URL de l’aperçu|Vorschau-URL|URL pratinjau|プレビューURL
Open isolated browser|Abrir navegador aislado|Ouvrir le navigateur isolé|Isolierten Browser öffnen|Buka browser terisolasi|分離ブラウザーを開く
Preview document or media|Vista previa de documento o multimedia|Aperçu du document ou média|Dokument oder Medien anzeigen|Pratinjau dokumen atau media|ドキュメントまたはメディアをプレビュー
Choose a valid date and time.|Elige una fecha y hora válidas.|Choisissez une date et une heure valides.|Wähle ein gültiges Datum und eine Uhrzeit.|Pilih tanggal dan waktu yang valid.|有効な日時を選択してください。
Back to files|Volver a archivos|Retour aux fichiers|Zurück zu Dateien|Kembali ke berkas|ファイルに戻る
Search files|Buscar archivos|Rechercher des fichiers|Dateien suchen|Cari berkas|ファイルを検索
Search contents|Buscar contenido|Rechercher dans le contenu|Inhalte durchsuchen|Cari isi|内容を検索
Cancel search|Cancelar búsqueda|Annuler la recherche|Suche abbrechen|Batalkan pencarian|検索をキャンセル
Up one folder|Subir una carpeta|Dossier parent|Übergeordneter Ordner|Naik satu folder|1つ上のフォルダー
Close media studio|Cerrar estudio multimedia|Fermer le studio multimédia|Medienstudio schließen|Tutup studio media|メディアスタジオを閉じる
Media studio|Estudio multimedia|Studio multimédia|Medienstudio|Studio media|メディアスタジオ
Media type|Tipo de contenido|Type de média|Medientyp|Jenis media|メディアの種類
Image|Imagen|Image|Bild|Gambar|画像
Video|Vídeo|Vidéo|Video|Video|動画
Generate|Generar|Générer|Generieren|Buat|生成
Export|Exportar|Exporter|Exportieren|Ekspor|エクスポート
Delete|Eliminar|Supprimer|Löschen|Hapus|削除
Close|Cerrar|Fermer|Schließen|Tutup|閉じる
Save settings|Guardar configuración|Enregistrer les paramètres|Einstellungen speichern|Simpan pengaturan|設定を保存
Browse|Examinar|Parcourir|Durchsuchen|Jelajahi|参照
Sign in to Grok|Iniciar sesión en Grok|Se connecter à Grok|Bei Grok anmelden|Masuk ke Grok|Grokにサインイン
Always ask|Preguntar siempre|Toujours demander|Immer fragen|Selalu tanyakan|常に確認
Approve for me|Aprobar por mí|Approuver pour moi|Für mich genehmigen|Setujui untuk saya|承認を任せる
Approve all|Aprobar todo|Tout approuver|Alles genehmigen|Setujui semua|すべて承認
`;
const values: Record<string, Partial<Record<Language, string>>> = {};
for (const line of rows.trim().split('\n')) {
  const [en, es, fr, de, id, ja] = line.split('|');
  if (!en || !es || !fr || !de || !id || !ja) throw new Error('Incomplete UI translation row.');
  values[en] = { es, fr, de, id, ja };
}
registerTranslations(values);
export const translatedLabels = Object.keys(values);
