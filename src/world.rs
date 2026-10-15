//! Mundo exacto del original: parsea los .tmx tal cual (capas CSV, tilesets,
//! objetos Scenes/Items/General), colision por flags solid/up/damage,
//! tips de texts.xml, musica por nivel y condiciones de victoria.
//! Unidades de mundo: 1 tile = 1.0 (los PNG pueden subir de resolucion sin romper nada).

use bevy::prelude::*;
use std::collections::HashMap;
use crate::game::{AppState, GameProgress, LevelComplete};
use crate::tmx::{parse_texts, parse_tmx, parse_tsx, TmxMap, TsxInfo};

macro_rules! tmx {
    ($n:expr) => {
        include_str!(concat!("../assets/maps/level", $n, ".tmx"))
    };
}

fn level_xml(n: u32) -> &'static str {
    match n {
        1 => tmx!("1"), 2 => tmx!("2"), 3 => tmx!("3"), 4 => tmx!("4"),
        5 => tmx!("5"), 6 => tmx!("6"), 7 => tmx!("7"), 8 => tmx!("8"),
        9 => tmx!("9"), 10 => tmx!("10"), 11 => tmx!("11"), 12 => tmx!("12"),
        13 => tmx!("13"), 14 => tmx!("14"), 15 => tmx!("15"), 16 => tmx!("16"),
        17 => tmx!("17"), _ => tmx!("18"),
    }
}

fn tsx_xml(source: &str) -> &'static str {
    // source = "tilesets/tileset_area1.tsx"
    if source.contains("area1") {
        include_str!("../assets/maps/tilesets/tileset_area1.tsx")
    } else if source.contains("area2") {
        include_str!("../assets/maps/tilesets/tileset_area2.tsx")
    } else if source.contains("area3") {
        include_str!("../assets/maps/tilesets/tileset_area3.tsx")
    } else if source.contains("area4") {
        include_str!("../assets/maps/tilesets/tileset_area4.tsx")
    } else if source.contains("area5") {
        include_str!("../assets/maps/tilesets/tileset_area5.tsx")
    } else if source.contains("area6") {
        include_str!("../assets/maps/tilesets/tileset_area6.tsx")
    } else if source.contains("cave2") {
        include_str!("../assets/maps/tilesets/tileset_cave2.tsx")
    } else {
        include_str!("../assets/maps/tilesets/tileset_cave.tsx")
    }
}

fn tsx_png(source: &str) -> String {
    // "tilesets/tileset_area1.tsx" -> "maps/tilesets/tileset_area1.png"
    format!("maps/{}", source.replace(".tsx", ".png"))
}

/// Grilla de colision en tiles: 0 vacio, 1 solido, 2 one-way, 3 dano.
#[derive(Resource, Default)]
pub struct SolidGrid {
    pub w: i32,
    pub h: i32,
    pub cells: Vec<u8>,
}

impl SolidGrid {
    pub fn at(&self, tx: i32, ty: i32) -> u8 {
        if tx < 0 || ty < 0 || tx >= self.w || ty >= self.h {
            return 1; // fuera del mapa = solido (no escapar)
        }
        self.cells[(ty * self.w + tx) as usize]
    }
}

/// Base de textos (tips) del original.
#[derive(Resource, Default)]
pub struct TextsDb {
    pub map: HashMap<String, String>,
}

/// Tip visible ahora + tiempo restante.
#[derive(Resource, Default)]
pub struct CurrentTip {
    pub text: String,
    pub timer: f32,
}

/// Musica sonando ahora.
#[derive(Resource, Default)]
pub struct LevelMusic {
    pub track: String,
}

/// Datos del nivel cargado.
#[derive(Resource, Default)]
pub struct LevelInfo {
    pub n: u32,
    pub width_tiles: i32,
    pub height_tiles: i32,
    pub has_boss: bool,
    pub done: bool,
}

#[derive(Component)]
pub struct TileSprite;

#[derive(Component)]
pub struct TriggerInfo {
    pub key: String,
    pub shown: bool,
}

#[derive(Component)]
pub struct TriggerSave;

#[derive(Component)]
pub struct MusicMarker;

/// Fisica AABB contra la grilla con delta ya aplicado en `delta`.
/// Devuelve (pos corregida, choco_x, apoyo_abajo, golpe_arriba, dano).
pub fn collide_move(
    pos: Vec2,
    half: Vec2,
    delta: Vec2,
    prev_bottom: f32,
    grid: &SolidGrid,
) -> (Vec2, bool, bool, bool, bool) {
    let mut p = pos;
    let mut hit_x = false;
    let mut grounded = false;
    let mut bonk = false;
    let mut hurt = false;

    // --- eje X ---
    p.x += delta.x;
    let (x0, x1) = (p.x - half.x, p.x + half.x);
    let (y0, y1) = (p.y - half.y, p.y + half.y);
    for ty in ((y0.floor() as i32)..=(y1.ceil() as i32 - 1)).filter(|_| true) {
        for tx in [(x0.floor() as i32), ((x1 - 0.001).floor() as i32)] {
            if grid.at(tx, ty) == 1 {
                if delta.x > 0.0 {
                    p.x = tx as f32 - half.x - 0.001;
                } else if delta.x < 0.0 {
                    p.x = (tx + 1) as f32 + half.x + 0.001;
                }
                hit_x = true;
            }
        }
    }
    // --- eje Y ---
    p.y += delta.y;
    let (x0, x1) = (p.x - half.x, p.x + half.x);
    let (y0, y1) = (p.y - half.y, p.y + half.y);
    for ty in [(y0.floor() as i32), ((y1 - 0.001).floor() as i32)] {
        for tx in (x0.floor() as i32)..=((x1 - 0.001).floor() as i32) {
            let c = grid.at(tx, ty);
            if c == 1 {
                if delta.y <= 0.0 {
                    p.y = (ty + 1) as f32 + half.y + 0.001;
                    grounded = true;
                } else {
                    p.y = ty as f32 - half.y - 0.001;
                    bonk = true;
                }
            } else if c == 2 {
                // one-way: solo si venia de arriba y cae
                let top = (ty + 1) as f32;
                if delta.y <= 0.0 && prev_bottom >= top - 0.05 {
                    p.y = top + half.y + 0.001;
                    grounded = true;
                }
            } else if c == 3 {
                // dano: lastima al tocar (no solido)
                if p.y - half.y < (ty + 1) as f32 && p.y + half.y > ty as f32 {
                    hurt = true;
                }
            }
        }
    }
    // dano por superposicion lateral tambien
    if !hurt {
        let (x0, x1) = (p.x - half.x, p.x + half.x);
        let (y0, y1) = (p.y - half.y, p.y + half.y);
        'scan: for ty in (y0.floor() as i32)..=(y1.ceil() as i32 - 1) {
            for tx in (x0.floor() as i32)..=(x1.ceil() as i32 - 1) {
                if grid.at(tx, ty) == 3 {
                    hurt = true;
                    break 'scan;
                }
            }
        }
    }
    (p, hit_x, grounded, bonk, hurt)
}

/// Convierte px del TMX (origen arriba-izq) a unidades de mundo (origen abajo-izq).
pub fn tmx_px_to_world(x: f32, y: f32, w: f32, h: f32, map_h_tiles: i32) -> Vec2 {
    Vec2::new((x + w * 0.5) / 32.0, (map_h_tiles as f32 * 32.0 - y - h * 0.5) / 32.0)
}

fn gid_tileset<'a>(gid: u32, refs: &'a [(u32, TsxInfo, String)]) -> Option<(u32, &'a TsxInfo, &'a String)> {
    // refs ordenados por firstgid; el ultimo cuyo firstgid <= gid gana
    let mut best: Option<(u32, &'a TsxInfo, &'a String)> = None;
    for (fg, info, png) in refs {
        if *fg <= gid {
            best = Some((*fg, info, png));
        }
    }
    best
}

#[allow(clippy::too_many_arguments)]
pub fn setup_level(
    commands: &mut Commands,
    asset_server: &AssetServer,
    progress: &mut GameProgress,
    grid: &mut SolidGrid,
    texts: &mut TextsDb,
    music: &mut LevelMusic,
    info: &mut LevelInfo,
    tip: &mut CurrentTip,
) {
    let n = progress.level.max(1).min(18);
    let map: TmxMap = parse_tmx(level_xml(n)).unwrap_or_default();
    let w = map.width.max(1);
    let h = map.height.max(1);

    // --- tilesets + flags ---
    let mut refs: Vec<(u32, TsxInfo, String)> = Vec::new();
    for t in &map.tilesets {
        let tsx = parse_tsx(tsx_xml(&t.source));
        refs.push((t.firstgid.max(1), tsx, tsx_png(&t.source)));
    }
    refs.sort_by_key(|r| r.0);

    // --- grilla de colision desde capa "Tiles" ---
    grid.w = w;
    grid.h = h;
    grid.cells = vec![0u8; (w * h) as usize];
    if let Some(layer) = map.layer("Tiles") {
        for (i, gid) in layer.data.iter().enumerate() {
            if *gid == 0 {
                continue;
            }
            if let Some((fg, tsx, _)) = gid_tileset(*gid, &refs) {
                let local = gid - fg;
                // gid 0 del tileset = tile id 0? En Tiled, local = gid - firstgid.
                // Los tsx del original numeran <tile id> igual (0-based).
                let flag = tsx.flags.get(&local).copied().unwrap_or(0);
                // OJO: muchos tiles sin flag son decoracion sobre solidos vecinos;
                // los solidos reales del original vienen marcados. Los no marcados = no colision.
                if (i as i32) < w * h {
                    grid.cells[i] = flag;
                }
            }
        }
    }

    // --- sprites de tiles (Tiles z=0, foreground z=2) ---
    let mut handles: HashMap<String, Handle<Image>> = HashMap::new();
    for (_, _, png) in &refs {
        handles.entry(png.clone()).or_insert_with(|| asset_server.load(png.clone()));
    }
    for (lname, z) in [("Tiles", 0.0f32), ("foreground", 2.0f32)] {
        if let Some(layer) = map.layer(lname) {
            for (i, gid) in layer.data.iter().enumerate() {
                if *gid == 0 {
                    continue;
                }
                let Some((fg, tsx, png)) = gid_tileset(*gid, &refs) else { continue };
                let local = gid - fg;
                let cols = (tsx.img_w / tsx.tile_w.max(1)).max(1);
                let cx = (local % cols) * tsx.tile_w;
                let cy = (local / cols) * tsx.tile_h;
                let tx = (i as i32) % w;
                let ty = (i as i32) / w; // fila desde arriba
                let wx = tx as f32 + 0.5;
                let wy = (h - ty) as f32 - 0.5;
                let handle = handles.get(png).cloned().unwrap_or_default();
                commands.spawn((
                    TileSprite,
                    Sprite {
                        image: handle,
                        rect: Some(Rect {
                            min: Vec2::new(cx as f32, cy as f32),
                            max: Vec2::new((cx + tsx.tile_w) as f32, (cy + tsx.tile_h) as f32),
                        }),
                        custom_size: Some(Vec2::splat(1.0)),
                        ..default()
                    },
                    Transform::from_translation(Vec3::new(wx, wy, z)),
                ));
            }
        }
    }

    // --- textos/tips ---
    if texts.map.is_empty() {
        texts.map = parse_texts(include_str!("../assets/texts.xml"));
    }
    tip.text.clear();
    tip.timer = 0.0;

    // --- objetos: Start / Info / Save ---
    let mut start = Vec2::new(2.0, 2.0);
    if let Some(g) = map.group("General") {
        for o in &g.objects {
            let p = tmx_px_to_world(o.x, o.y, o.w, o.h, h);
            match o.name.as_str() {
                "Start" => start = p,
                "*Save" => {
                    commands.spawn((
                        TriggerSave,
                        Sprite {
                            color: Color::srgb(0.3, 1.0, 0.5),
                            custom_size: Some(Vec2::new(0.6, 1.2)),
                            ..default()
                        },
                        Transform::from_translation(p.extend(3.0)),
                    ));
                }
                "*Info" => {
                    let key = o.props.iter().find(|(k, _)| k == "info").map(|(_, v)| v.clone()).unwrap_or_default();
                    commands.spawn((
                        TriggerInfo { key, shown: false },
                        Transform::from_translation(p.extend(3.0)),
                    ));
                }
                _ => {}
            }
        }
    }
    progress.checkpoint = start;

    // --- items exactos ---
    if let Some(g) = map.group("Items") {
        for o in &g.objects {
            let p = tmx_px_to_world(o.x, o.y, o.w, o.h, h);
            let kind = match o.name.as_str() {
                "&Life1" | "&Life2" => Some(crate::items::ItemKind::Heart),
                "&P-SustainJump" => Some(crate::items::ItemKind::Sneaker),
                "&P-JumpAttack" => Some(crate::items::ItemKind::JumpAttack),
                "&B-Item1" | "&B-Item2" => Some(crate::items::ItemKind::BoomerangUp),
                "&Key1" => Some(crate::items::ItemKind::Key),
                "Energy" => Some(crate::items::ItemKind::Cereal),
                "FullEnergy" => Some(crate::items::ItemKind::FullEnergy),
                _ => None,
            };
            if let Some(k) = kind {
                crate::items::spawn_item_kind(commands, k, p);
            }
        }
    }

    // --- enemigos exactos (Scenes) ---
    info.has_boss = false;
    if let Some(g) = map.group("Scenes") {
        for o in &g.objects {
            let p = tmx_px_to_world(o.x, o.y, o.w, o.h, h);
            if let Some((kind, boss)) = crate::enemy::enemy_kind_from_tmx(&o.name) {
                crate::enemy::spawn_enemy_kind(commands, kind, p);
                info.has_boss = info.has_boss || boss;
            }
        }
    }
    info.n = n;
    info.width_tiles = w;
    info.height_tiles = h;
    info.done = false;
    progress.boss_hp = 0.0;
    progress.boss_name.clear();

    // --- musica del nivel (props music,normal / defaultMusic) ---
    let track = map
        .prop("music,normal")
        .or_else(|| map.prop("defaultMusic"))
        .unwrap_or("normal");
    let file: String = match track {
        "normal" => "audio/music/win/menu.ogg".to_string(),
        s if s.ends_with(".ogg") => {
            // las props traen solo nombre ("level1.ogg"); estan en music/win
            if s.contains('/') { s.to_string() } else { format!("audio/music/win/{}", s) }
        }
        _ => "audio/music/win/menu.ogg".to_string(),
    };
    // hack temporal: level1..6 existen; el resto usa menu.ogg (se mapea abajo)
    let file = real_music_file(n, &file);
    music.track = file.clone();
    let music_handle: Handle<AudioSource> = asset_server.load(file);
    commands.spawn((
        MusicMarker,
        AudioPlayer(music_handle),
        PlaybackSettings::LOOP,
    ));

    // jugador al Start
    crate::player::spawn_player(commands, progress);
}

fn real_music_file(n: u32, _wanted: &str) -> String {
    // Solo existen level1..6 + menu/boss*. Los demas niveles reutilizan por area.
    const HAVE: [u32; 6] = [1, 2, 3, 4, 5, 6];
    if HAVE.contains(&n) {
        format!("audio/music/win/level{}.ogg", n)
    } else {
        format!("audio/music/win/level{}.ogg", ((n - 1) % 6) + 1)
    }
}

/// Limpia todo lo del nivel anterior.
pub fn cleanup_level(
    commands: &mut Commands,
    q: &Query<
        Entity,
        Or<(
            With<TileSprite>,
            With<TriggerInfo>,
            With<TriggerSave>,
            With<MusicMarker>,
            With<crate::player::Player>,
            With<crate::enemy::Enemy>,
            With<crate::items::Item>,
            With<crate::player::Boomerang>,
        )>,
    >,
) {
    for e in q {
        commands.entity(e).despawn_recursive();
    }
}

/// Tips *Info: al acercarse muestra el texto de texts.xml unos segundos.
pub fn tip_triggers(
    time: Res<Time>,
    state: Res<State<AppState>>,
    texts: Res<TextsDb>,
    mut tip: ResMut<CurrentTip>,
    q_player: Query<&Transform, With<crate::player::Player>>,
    mut q_info: Query<(&Transform, &mut TriggerInfo)>,
) {
    tip.timer = (tip.timer - time.delta_secs()).max(0.0);
    if tip.timer <= 0.0 {
        tip.text.clear();
    }
    if *state.get() != AppState::Playing {
        return;
    }
    let Ok(ptf) = q_player.get_single() else { return };
    let pp = ptf.translation.truncate();
    for (tf, mut info) in &mut q_info {
        if (tf.translation.truncate() - pp).length() < 1.5 {
            if !info.shown {
                info.shown = true;
                if let Some(t) = texts.map.get(&info.key) {
                    tip.text = t.clone();
                    tip.timer = 5.0;
                }
            }
        } else if (tf.translation.truncate() - pp).length() > 3.0 {
            info.shown = false; // re-mostrar si vuelve
        }
    }
}

/// Checkpoints *Save.
pub fn save_triggers(
    state: Res<State<AppState>>,
    mut progress: ResMut<GameProgress>,
    q_player: Query<&Transform, With<crate::player::Player>>,
    q_save: Query<&Transform, With<TriggerSave>>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
) {
    if *state.get() != AppState::Playing {
        return;
    }
    let Ok(ptf) = q_player.get_single() else { return };
    for stf in &q_save {
        if (stf.translation.truncate() - ptf.translation.truncate()).length() < 1.2
            && progress.checkpoint.distance_squared(ptf.translation.truncate()) > 1.0
        {
            progress.checkpoint = stf.translation.truncate();
            crate::save::write_checkpoint(&crate::save::SaveData {
                level: progress.level,
                lives: progress.lives,
                coins: progress.coins,
                unlocked: progress.unlocked,
                x: progress.checkpoint.x,
                y: progress.checkpoint.y,
            });
            crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Save);
        }
    }
}

/// Musica de jefe al acercarse + victoria al limpiar/defender.
pub fn level_director(
    state: Res<State<AppState>>,
    progress: Res<GameProgress>,
    mut info: ResMut<LevelInfo>,
    mut music: ResMut<LevelMusic>,
    q_player: Query<&Transform, With<crate::player::Player>>,
    q_boss: Query<&crate::enemy::Enemy>,
    q_music: Query<Entity, With<MusicMarker>>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut complete: EventWriter<LevelComplete>,
) {
    if *state.get() != AppState::Playing || info.done {
        return;
    }
    let Ok(ptf) = q_player.get_single() else { return };
    let px = ptf.translation.x;

    // cambio a musica de jefe cerca del boss
    let boss_near = q_boss.iter().any(|e| e.boss);
    if boss_near && music.track != "audio/music/win/boss.ogg" && px > info.width_tiles as f32 * 0.6 {
        for e in &q_music {
            commands.entity(e).despawn_recursive();
        }
        music.track = "audio/music/win/boss.ogg".to_string();
        music.track = "audio/music/win/boss.ogg".to_string();
        let boss_handle: Handle<AudioSource> = asset_server.load("audio/music/win/boss.ogg");
        commands.spawn((
            MusicMarker,
            AudioPlayer(boss_handle),
            PlaybackSettings::LOOP,
        ));
    }

    // victoria: sin bosses vivos y zona final (o todos los jefes muertos)
    let bosses_alive = q_boss.iter().filter(|e| e.boss).count();
    if info.has_boss {
        if bosses_alive == 0 && px > info.width_tiles as f32 - 14.0 {
            info.done = true;
            complete.send(LevelComplete);
        }
    } else if px > info.width_tiles as f32 - 8.0 {
        info.done = true;
        complete.send(LevelComplete);
    }
}
