//! Parser minimo del formato original: mapas .tmx (Tiled 1.0, CSV),
//! tilesets .tsx (flags solid/up/damage) y texts.xml (tips).
//! Todo separsea tal cual lo escribio el juego original, sin conversion previa.

use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct TmxTilesetRef {
    pub firstgid: u32,
    pub source: String, // ej "tilesets/tileset_area1.tsx"
}

#[derive(Debug, Clone, Default)]
pub struct TmxLayer {
    pub name: String,
    pub width: i32,
    pub height: i32,
    pub data: Vec<u32>,
}

#[derive(Debug, Clone, Default)]
pub struct TmxObject {
    pub name: String,
    pub otype: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub props: Vec<(String, String)>,
}

#[derive(Debug, Clone, Default)]
pub struct TmxGroup {
    pub name: String,
    pub objects: Vec<TmxObject>,
}

#[derive(Debug, Clone, Default)]
pub struct TmxMap {
    pub width: i32,
    pub height: i32,
    pub tile_w: i32,
    pub tile_h: i32,
    pub props: Vec<(String, String)>,
    pub tilesets: Vec<TmxTilesetRef>,
    pub layers: Vec<TmxLayer>,
    pub groups: Vec<TmxGroup>,
}

impl TmxMap {
    pub fn prop(&self, key: &str) -> Option<&str> {
        self.props.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
    pub fn group(&self, name: &str) -> Option<&TmxGroup> {
        self.groups.iter().find(|g| g.name == name)
    }
    pub fn layer(&self, name: &str) -> Option<&TmxLayer> {
        self.layers.iter().find(|l| l.name == name)
    }
}

fn attr_value(e: &quick_xml::events::BytesStart, key: &[u8]) -> Option<String> {
    for a in e.attributes().flatten() {
        if a.key.as_ref() == key {
            return a.decoded_value().ok().map(|c| c.into_owned());
        }
    }
    None
}

fn num<T: std::str::FromStr>(s: Option<String>, d: T) -> T {
    s.as_deref().unwrap_or("").parse().unwrap_or(d)
}

/// Parsea un .tmx completo (capas CSV, objetos, propiedades).
pub fn parse_tmx(xml: &str) -> Result<TmxMap, String> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    let mut r = Reader::from_str(xml);
    r.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut map = TmxMap::default();
    let mut in_props = false;
    let mut props_target = 0u8; // 0=map 1=layer 2=object (solo usamos map y object)
    let mut cur_layer: Option<TmxLayer> = None;
    let mut in_data = false;
    let mut data_text = String::new();
    let mut data_encoding = String::new();
    let mut cur_group: Option<TmxGroup> = None;
    let mut cur_obj: Option<TmxObject> = None;
    let mut in_obj_props = false;

    loop {
        match r.read_event_into(&mut buf).map_err(|e| e.to_string())? {
            Event::Start(e) => match e.name().as_ref() {
                b"map" => {
                    map.width = num(attr_value(&e, b"width"), 0);
                    map.height = num(attr_value(&e, b"height"), 0);
                    map.tile_w = num(attr_value(&e, b"tilewidth"), 32);
                    map.tile_h = num(attr_value(&e, b"tileheight"), 32);
                }
                b"properties" => {
                    in_props = true;
                    in_obj_props = cur_obj.is_some();
                }
                b"property" => {
                    let k = attr_value(&e, b"name").unwrap_or_default();
                    let v = attr_value(&e, b"value").unwrap_or_default();
                    if in_obj_props {
                        if let Some(o) = cur_obj.as_mut() {
                            o.props.push((k, v));
                        }
                    } else {
                        let _ = props_target;
                        map.props.push((k, v));
                    }
                }
                b"tileset" => {
                    map.tilesets.push(TmxTilesetRef {
                        firstgid: num(attr_value(&e, b"firstgid"), 1),
                        source: attr_value(&e, b"source").unwrap_or_default(),
                    });
                }
                b"layer" => {
                    cur_layer = Some(TmxLayer {
                        name: attr_value(&e, b"name").unwrap_or_default(),
                        width: num(attr_value(&e, b"width"), 0),
                        height: num(attr_value(&e, b"height"), 0),
                        data: Vec::new(),
                    });
                }
                b"data" => {
                    in_data = true;
                    data_text.clear();
                    data_encoding = attr_value(&e, b"encoding").unwrap_or_default();
                }
                b"objectgroup" => {
                    cur_group = Some(TmxGroup {
                        name: attr_value(&e, b"name").unwrap_or_default(),
                        objects: Vec::new(),
                    });
                }
                b"object" => {
                    cur_obj = Some(TmxObject {
                        name: attr_value(&e, b"name").unwrap_or_default(),
                        otype: attr_value(&e, b"type").unwrap_or_default(),
                        x: num(attr_value(&e, b"x"), 0.0),
                        y: num(attr_value(&e, b"y"), 0.0),
                        w: num(attr_value(&e, b"width"), 32.0),
                        h: num(attr_value(&e, b"height"), 32.0),
                        props: Vec::new(),
                    });
                }
                _ => {}
            },
            Event::Empty(e) => match e.name().as_ref() {
                b"tileset" => {
                    map.tilesets.push(TmxTilesetRef {
                        firstgid: num(attr_value(&e, b"firstgid"), 1),
                        source: attr_value(&e, b"source").unwrap_or_default(),
                    });
                }
                b"property" => {
                    let k = attr_value(&e, b"name").unwrap_or_default();
                    let v = attr_value(&e, b"value").unwrap_or_default();
                    if in_obj_props {
                        if let Some(o) = cur_obj.as_mut() {
                            o.props.push((k, v));
                        }
                    } else {
                        map.props.push((k, v));
                    }
                }
                b"object" => {
                    if let Some(o) = cur_obj.take().or_else(|| {
                        Some(TmxObject {
                            name: attr_value(&e, b"name").unwrap_or_default(),
                            otype: attr_value(&e, b"type").unwrap_or_default(),
                            x: num(attr_value(&e, b"x"), 0.0),
                            y: num(attr_value(&e, b"y"), 0.0),
                            w: num(attr_value(&e, b"width"), 32.0),
                            h: num(attr_value(&e, b"height"), 32.0),
                            props: Vec::new(),
                        })
                    }) {
                        if let Some(g) = cur_group.as_mut() {
                            g.objects.push(o);
                        }
                    }
                }
                _ => {}
            },
            Event::Text(e) => {
                if in_data {
                    data_text.push_str(&e.decoded().map_err(|e| e.to_string())?);
                }
            }
            Event::End(e) => match e.name().as_ref() {
                b"properties" => {
                    in_props = false;
                    in_obj_props = false;
                }
                b"data" => {
                    in_data = false;
                    if let Some(l) = cur_layer.as_mut() {
                        if data_encoding == "csv" {
                            l.data = data_text
                                .split(|c: char| c == ',' || c.is_whitespace())
                                .filter(|s| !s.is_empty())
                                .map(|s| s.parse().unwrap_or(0))
                                .collect();
                        }
                    }
                }
                b"layer" => {
                    if let Some(l) = cur_layer.take() {
                        map.layers.push(l);
                    }
                }
                b"objectgroup" => {
                    if let Some(g) = cur_group.take() {
                        map.groups.push(g);
                    }
                }
                b"object" => {
                    if let Some(o) = cur_obj.take() {
                        if let Some(g) = cur_group.as_mut() {
                            g.objects.push(o);
                        }
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(map)
}

/// Flags de colision por tile: 0 vacio, 1 solido, 2 one-way (up), 3 dano.
#[derive(Debug, Clone, Default)]
pub struct TsxInfo {
    pub tile_w: u32,
    pub tile_h: u32,
    pub img_w: u32,
    pub img_h: u32,
    pub flags: HashMap<u32, u8>,
}

pub fn parse_tsx(xml: &str) -> TsxInfo {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    let mut out = TsxInfo { tile_w: 32, tile_h: 32, img_w: 1024, img_h: 1024, flags: HashMap::new() };
    let mut r = Reader::from_str(xml);
    r.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut cur_tile: Option<u32> = None;
    loop {
        match r.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                match e.name().as_ref() {
                    b"tileset" => {
                        out.tile_w = num(attr_value(&e, b"tilewidth"), 32);
                        out.tile_h = num(attr_value(&e, b"tileheight"), 32);
                    }
                    b"image" => {
                        out.img_w = num(attr_value(&e, b"width"), 1024);
                        out.img_h = num(attr_value(&e, b"height"), 1024);
                    }
                    b"tile" => {
                        cur_tile = attr_value(&e, b"id").and_then(|s| s.parse().ok());
                    }
                    b"property" => {
                        if let (Some(id), Some(name)) =
                            (cur_tile, attr_value(&e, b"name"))
                        {
                            let flag = match name.as_str() {
                                "solid" => 1u8,
                                "up" => 2u8,
                                "damage" => 3u8,
                                _ => 0u8,
                            };
                            if flag > 0 {
                                out.flags.entry(id).and_modify(|f| *f = (*f).max(flag)).or_insert(flag);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                if e.name().as_ref() == b"tile" {
                    cur_tile = None;
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

/// texts.xml -> mapa clave->texto (convierte \n literal en salto real).
pub fn parse_texts(xml: &str) -> HashMap<String, String> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    let mut out = HashMap::new();
    let mut r = Reader::from_str(xml);
    r.config_mut().trim_text(true);
    let mut buf = Vec::new();
    loop {
        match r.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if e.name().as_ref() == b"node" {
                    let k = attr_value(&e, b"key").unwrap_or_default();
                    let t = attr_value(&e, b"text").unwrap_or_default();
                    if !k.is_empty() {
                        out.insert(k, t.replace("\\n", "\n"));
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}
