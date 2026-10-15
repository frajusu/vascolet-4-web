//! Tabla de niveles 1-18 sacada de los .tmx + tips de texts.xml.
//! El TMX real se parsea en el futuro; por ahora cada nivel define metadata,
//! spawn del jugador, jefe y longitud aproximada (en tiles) para generar terreno.

use bevy::prelude::Vec2;

pub const ORIG_TILE_PX: f32 = 32.0;
pub const TILE_UNITS: f32 = 1.0;

pub struct LevelDef {
    pub n: u32,
    pub name: &'static str,
    pub tmx: &'static str,
    pub music: &'static str,
    pub boss: Option<&'static str>,
    pub tip: &'static str,
    pub width_tiles: i32,
}

/// Los 18 niveles del original (level1..level18 del assets/data/maps).
pub const LEVELS: [LevelDef; 18] = [
    LevelDef { n: 1, name: "Jardin de insectos", tmx: "maps/level1.tmx", music: "level1.ogg", boss: Some("BigScorpion"), tip: "Usa las flechas para moverte. Z/S salta, A/X dispara.", width_tiles: 449 },
    LevelDef { n: 2, name: "Zona derecha", tmx: "maps/level2.tmx", music: "level2.ogg", boss: None, tip: "Vamos derecho... cuidado con quedar encerrado en piedras.", width_tiles: 320 },
    LevelDef { n: 3, name: "Topo ninja", tmx: "maps/level3.tmx", music: "level3.ogg", boss: Some("TopoNinja"), tip: "Agachate y anticipate a sus acciones.", width_tiles: 300 },
    LevelDef { n: 4, name: "Zona de arboles", tmx: "maps/level4.tmx", music: "level4.ogg", boss: Some("Birds"), tip: "Salta con cuidado, aqui viven los pajaros.", width_tiles: 340 },
    LevelDef { n: 5, name: "Tunel peligroso", tmx: "maps/level5.tmx", music: "level5.ogg", boss: None, tip: "Agarrate Alejandro, este tunel es peligroso.", width_tiles: 300 },
    LevelDef { n: 6, name: "Bicho peludo", tmx: "maps/level6.tmx", music: "level6.ogg", boss: Some("FurryCritter"), tip: "Ten mucho cuidado con el bicho peludo.", width_tiles: 320 },
    LevelDef { n: 7, name: "Libelulas", tmx: "maps/level7.tmx", music: "level7.ogg", boss: Some("GreenDragon"), tip: "Salta y disparale al dragon verde.", width_tiles: 340 },
    LevelDef { n: 8, name: "El abismo", tmx: "maps/level8.tmx", music: "level8.ogg", boss: None, tip: "Zona llena de enemigos voladores.", width_tiles: 300 },
    LevelDef { n: 9, name: "Libelula gigante", tmx: "maps/level9.tmx", music: "level9.ogg", boss: Some("GiantDragonfly"), tip: "Anticipate a su ataque, es muy veloz.", width_tiles: 320 },
    LevelDef { n: 10, name: "Estanque del miedo", tmx: "maps/level10.tmx", music: "level10.ogg", boss: Some("Eel"), tip: "Cuidado con la anguila del pasaje secreto.", width_tiles: 300 },
    LevelDef { n: 11, name: "Pasaje secreto", tmx: "maps/level11.tmx", music: "level11.ogg", boss: None, tip: "Este es el pasaje secreto...", width_tiles: 220 },
    LevelDef { n: 12, name: "Camino al castillo", tmx: "maps/level12.tmx", music: "level12.ogg", boss: Some("SkullPirana"), tip: "En este pozo vive la pirana esqueleto.", width_tiles: 280 },
    LevelDef { n: 13, name: "Castillo: ventanas", tmx: "maps/level13.tmx", music: "level13.ogg", boss: Some("LibraryBat"), tip: "Malmark abrio todas las ventanas...", width_tiles: 340 },
    LevelDef { n: 14, name: "Salon peligroso", tmx: "maps/level14.tmx", music: "level14.ogg", boss: None, tip: "Malmark siempre deja las ventanas abiertas.", width_tiles: 300 },
    LevelDef { n: 15, name: "Camara de Malmark", tmx: "maps/level15.tmx", music: "level15.ogg", boss: Some("Spider"), tip: "Cuidado con la arana que dispara mucho.", width_tiles: 320 },
    LevelDef { n: 16, name: "Camaras finales", tmx: "maps/level16.tmx", music: "level16.ogg", boss: Some("AngryGhost"), tip: "Usa todas tus habilidades para sobrevivir.", width_tiles: 340 },
    LevelDef { n: 17, name: "Piso tramposo", tmx: "maps/level17.tmx", music: "level17.ogg", boss: None, tip: "Salta ya Alejandro, que no te atrape el piso.", width_tiles: 300 },
    LevelDef { n: 18, name: "Final", tmx: "maps/level18.tmx", music: "final.ogg", boss: Some("Malmark"), tip: "El final: derrota a Malmark.", width_tiles: 320 },
];

pub fn level_def(n: u32) -> &'static LevelDef {
    let i = (n.max(1).min(18) - 1) as usize;
    &LEVELS[i]
}

pub fn player_start(_level: u32) -> Vec2 {
    Vec2::new(2.0, 2.0)
}

pub fn tmx_tile_to_world(tx: i32, ty: i32, map_h_tiles: i32) -> Vec2 {
    Vec2::new(tx as f32 + 0.5, (map_h_tiles - ty) as f32 - 0.5)
}

/// Recorte del atlas independiente de la resolucion del PNG.
pub fn tile_uv(gid: u32, sheet_px: f32, tile_px: f32) -> (f32, f32, f32, f32) {
    let cols = (sheet_px / tile_px).max(1.0) as u32;
    let id = gid.saturating_sub(1);
    let col = (id % cols) as f32;
    let row = (id / cols) as f32;
    let u0 = col * tile_px / sheet_px;
    let v0 = row * tile_px / sheet_px;
    let s = tile_px / sheet_px;
    (u0, v0, s, s)
}
