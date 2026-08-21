using System;
using System.Collections.Generic;
using BepInEx;
using BepInEx.Configuration;
using HarmonyLib;
using UnityEngine;
using UnityEngine.Rendering;

namespace DSP_FullStarmap
{
    [BepInPlugin(GUID, NAME, VERSION)]
    public sealed class FullStarmapPlugin : BaseUnityPlugin
    {
        public const string GUID = "com.openai.dsp.fullstarmap";
        public const string NAME = "Full Starmap";
        public const string VERSION = "0.4.0";

        private static FullStarmapPlugin instance;
        private Harmony harmony;
        private NativeRenderer native;
        private ConfigEntry<bool> enabled;
        private ConfigEntry<bool> loadFactories;
        private ConfigEntry<bool> unloadOnClose;
        private ConfigEntry<int> maxPlanets;

        private void Awake()
        {
            instance = this;
            enabled = Config.Bind("General", "Enabled", true, "Render V with DSP native planet/factory rendering.");
            loadFactories = Config.Bind("Rendering", "LoadFactories", true, "Load remote factory models while V is open.");
            unloadOnClose = Config.Bind("Rendering", "UnloadOnClose", true, "Unload assets that this mod loaded when V closes.");
            maxPlanets = Config.Bind("Performance", "MaxPlanets", 0, new ConfigDescription("Maximum visible native planets. 0 = unlimited.", new AcceptableValueRange<int>(0, 64)));
            native = new NativeRenderer(this);
            harmony = new Harmony(GUID);
            harmony.PatchAll(typeof(FullStarmapPlugin));
            Logger.LogInfo("Full Starmap 0.4.0 loaded for DSP 0.10.34.28529.");
        }

        private void LateUpdate()
        {
            UIStarmap map = UIRoot.instance != null && UIRoot.instance.uiGame != null ? UIRoot.instance.uiGame.starmap : null;
            if (!enabled.Value || map == null || !map.isFullOpened)
            {
                native.Dispose();
                return;
            }
            native.Update(map);
        }

        private void OnDestroy()
        {
            native?.Dispose();
            harmony?.UnpatchSelf();
            instance = null;
        }

        private bool FreezePlayer() => native != null && native.Active;

        [HarmonyPrefix, HarmonyPatch(typeof(PlayerController), nameof(PlayerController.GameTick))]
        private static bool PlayerGameTick() => instance == null || !instance.FreezePlayer();

        [HarmonyPrefix, HarmonyPatch(typeof(PlayerController), "LateUpdate")]
        private static bool PlayerLateUpdate() => instance == null || !instance.FreezePlayer();

        [HarmonyPrefix, HarmonyPatch(typeof(PlayerOrder), nameof(PlayerOrder.GameTick))]
        private static bool PlayerOrderTick() => instance == null || !instance.FreezePlayer();

        private sealed class NativeRenderer
        {
            private readonly FullStarmapPlugin owner;
            private readonly Dictionary<int, PlanetCtx> ctx = new Dictionary<int, PlanetCtx>();
            private readonly HashSet<int> seen = new HashSet<int>();
            private readonly List<int> remove = new List<int>();
            private Camera mapCam;
            private Camera gameCam;
            private bool mapSaved;
            private int mapMask;
            private CameraClearFlags mapClear;
            private Color mapBg;
            private bool gameSaved;
            private Vector3 gamePos;
            private Quaternion gameRot;
            private float gameFov, gameNear, gameFar;
            private int gameMask;
            private bool gameEnabled;
            private CameraClearFlags gameClear;
            private bool hideSaved;
            private bool oldHide;

            public bool Active => mapSaved && ctx.Count > 0;
            public NativeRenderer(FullStarmapPlugin owner) { this.owner = owner; }

            public void Update(UIStarmap map)
            {
                if (map.screenCamera == null) { Dispose(); return; }
                CaptureCameras(map.screenCamera);
                ApplyCameras();

                var uis = map.planetUIs;
                if (uis == null) return;
                seen.Clear();
                int accepted = 0;
                for (int i = 0; i < uis.Length; i++)
                {
                    var ui = uis[i];
                    if (ui == null || ui.planet == null || ui.planetRenderer == null || !ui.gameObject.activeInHierarchy) continue;
                    if (owner.maxPlanets.Value > 0 && accepted >= owner.maxPlanets.Value) continue;
                    accepted++;
                    int id = ui.planet.id;
                    seen.Add(id);
                    PlanetCtx p;
                    if (!ctx.TryGetValue(id, out p)) { p = new PlanetCtx(owner, ui.planet); ctx.Add(id, p); }
                    try { p.Update(ui, gameCam != null ? gameCam : mapCam); }
                    catch (Exception e) { owner.Logger.LogError("Native V planet " + id + " failed: " + e); p.Disable(); }
                }

                remove.Clear();
                foreach (var kv in ctx) if (!seen.Contains(kv.Key)) remove.Add(kv.Key);
                foreach (int id in remove) { ctx[id].Dispose(owner.unloadOnClose.Value); ctx.Remove(id); }
            }

            private void CaptureCameras(Camera m)
            {
                if (!mapSaved)
                {
                    mapCam = m; mapMask = m.cullingMask; mapClear = m.clearFlags; mapBg = m.backgroundColor; mapSaved = true;
                    if (GameMain.data != null) { oldHide = GameMain.data.hidePlayerModel; hideSaved = true; }
                }
                gameCam = GameCamera.main;
                if (!gameSaved && gameCam != null)
                {
                    gamePos = gameCam.transform.position; gameRot = gameCam.transform.rotation; gameFov = gameCam.fieldOfView;
                    gameNear = gameCam.nearClipPlane; gameFar = gameCam.farClipPlane; gameMask = gameCam.cullingMask;
                    gameEnabled = gameCam.enabled; gameClear = gameCam.clearFlags; gameSaved = true;
                }
            }

            private void ApplyCameras()
            {
                if (mapCam == null) return;
                mapCam.clearFlags = CameraClearFlags.Depth;
                if (gameCam != null)
                {
                    gameCam.enabled = true;
                    gameCam.transform.position = mapCam.transform.position;
                    gameCam.transform.rotation = mapCam.transform.rotation;
                    gameCam.fieldOfView = mapCam.fieldOfView;
                    gameCam.nearClipPlane = Math.Max(0.01f, mapCam.nearClipPlane);
                    gameCam.farClipPlane = Math.Max(100000f, mapCam.farClipPlane);
                    if (GameCamera.instance != null) gameCam.cullingMask = (int)GameCamera.instance.gameLayerMask;
                }
                if (GameMain.data != null) GameMain.data.hidePlayerModel = true;
            }

            public void Dispose()
            {
                foreach (var p in ctx.Values) { try { p.Dispose(owner.unloadOnClose.Value); } catch { } }
                ctx.Clear(); seen.Clear(); remove.Clear();
                if (mapSaved && mapCam != null) { mapCam.cullingMask = mapMask; mapCam.clearFlags = mapClear; mapCam.backgroundColor = mapBg; }
                if (gameSaved && gameCam != null)
                {
                    gameCam.transform.position = gamePos; gameCam.transform.rotation = gameRot; gameCam.fieldOfView = gameFov;
                    gameCam.nearClipPlane = gameNear; gameCam.farClipPlane = gameFar; gameCam.cullingMask = gameMask;
                    gameCam.enabled = gameEnabled; gameCam.clearFlags = gameClear;
                }
                if (hideSaved && GameMain.data != null) GameMain.data.hidePlayerModel = oldHide;
                mapCam = null; gameCam = null; mapSaved = false; gameSaved = false; hideSaved = false;
            }

            private sealed class PlanetCtx
            {
                private static readonly System.Reflection.MethodInfo Load = AccessTools.Method(typeof(PlanetData), "Load");
                private static readonly System.Reflection.MethodInfo LoadFactory = AccessTools.Method(typeof(PlanetData), "LoadFactory");
                private static readonly System.Reflection.MethodInfo Unload = AccessTools.Method(typeof(PlanetData), "Unload");
                private static readonly System.Reflection.MethodInfo UnloadFactory = AccessTools.Method(typeof(PlanetData), "UnloadFactory");
                private readonly FullStarmapPlugin owner;
                private readonly PlanetData planet;
                private readonly bool wasLoaded, wasFactoryLoaded;
                private bool requestedBody, requestedFactory, disabled;
                private UIStarmapPlanet ui;
                private bool schematicSaved, schematicEnabled;
                private Transform root;
                private Transform rootParent;
                private Vector3 rootLP, rootLS;
                private Quaternion rootLR;
                private bool rootActive, rootSaved;
                private bool bodySaved, bodyActive;
                private PlanetSimulator sim;
                private Transform simT, simParent;
                private Vector3 simLP, simLS;
                private Quaternion simLR;
                private bool simSaved;
                private float simRadius;

                public PlanetCtx(FullStarmapPlugin owner, PlanetData planet)
                {
                    this.owner = owner; this.planet = planet; wasLoaded = planet.loaded; wasFactoryLoaded = planet.factoryLoaded;
                }

                public void Update(UIStarmapPlanet newUi, Camera cam)
                {
                    if (disabled) return;
                    if (ui != newUi) { RestoreSchematic(); ui = newUi; schematicSaved = false; }
                    RequestAssets();
                    if (planet.gameObject == null) return;
                    PlaceRoot(newUi);
                    PlaceSimulator(newUi);
                    HideSchematic();
                    if (owner.loadFactories.Value && planet.factoryLoaded && planet.factoryModel != null && cam != null)
                        planet.factoryModel.DrawInstancedBatches(cam, true);
                }

                private void RequestAssets()
                {
                    if (!planet.loaded && !planet.loading && !requestedBody && Load != null) { requestedBody = true; Load.Invoke(planet, null); }
                    if (owner.loadFactories.Value && planet.loaded && planet.bodyObject != null && planet.factory != null && !planet.factoryLoaded && !planet.factoryLoading && !requestedFactory && LoadFactory != null)
                    { requestedFactory = true; LoadFactory.Invoke(planet, null); }
                }

                private static float Radius(Renderer r)
                {
                    if (r == null) return 0f; Vector3 e = r.bounds.extents; return Math.Max(e.x, Math.Max(e.y, e.z));
                }

                private void PlaceRoot(UIStarmapPlanet u)
                {
                    var t = planet.gameObject.transform;
                    if (!rootSaved || root != t)
                    {
                        RestoreRoot(); root = t; rootParent = t.parent; rootLP = t.localPosition; rootLR = t.localRotation; rootLS = t.localScale;
                        rootActive = t.gameObject.activeSelf; rootSaved = true;
                        if (planet.bodyObject != null) { bodyActive = planet.bodyObject.activeSelf; bodySaved = true; }
                    }
                    float tr = Radius(u.planetRenderer); if (tr <= 0.0001f) return;
                    float ratio = tr / Math.Max(1f, planet.realRadius);
                    if (!root.gameObject.activeSelf) root.gameObject.SetActive(true);
                    if (planet.bodyObject != null && !planet.bodyObject.activeSelf) planet.bodyObject.SetActive(true);
                    root.position = u.planetRenderer.bounds.center; root.rotation = u.planetRenderer.transform.rotation; root.localScale = rootLS * ratio;
                }

                private void PlaceSimulator(UIStarmapPlanet u)
                {
                    var universe = GameMain.universeSimulator;
                    var s = universe != null ? universe.FindPlanetSimulator(planet) : null;
                    if (s == null || s.transform == null) { RestoreSim(); return; }
                    if (!simSaved || sim != s)
                    {
                        RestoreSim(); sim = s; simT = s.transform; simParent = simT.parent; simLP = simT.localPosition; simLR = simT.localRotation; simLS = simT.localScale;
                        simRadius = Radius(s.farRenderer); simSaved = true;
                    }
                    float tr = Radius(u.planetRenderer); if (tr <= 0.0001f) return;
                    float sr = simRadius > 0.0001f ? simRadius : Math.Max(1f, planet.realRadius);
                    simT.position = u.planetRenderer.bounds.center; simT.rotation = u.planetRenderer.transform.rotation; simT.localScale = simLS * (tr / sr);
                }

                private void HideSchematic()
                {
                    if (ui == null || ui.planetRenderer == null) return;
                    if (!schematicSaved) { schematicEnabled = ui.planetRenderer.enabled; schematicSaved = true; }
                    ui.planetRenderer.enabled = false;
                }
                private void RestoreSchematic() { if (schematicSaved && ui != null && ui.planetRenderer != null) ui.planetRenderer.enabled = schematicEnabled; schematicSaved = false; }
                private void RestoreRoot()
                {
                    if (!rootSaved || root == null) { rootSaved = false; return; }
                    root.SetParent(rootParent, false); root.localPosition = rootLP; root.localRotation = rootLR; root.localScale = rootLS; root.gameObject.SetActive(rootActive);
                    if (bodySaved && planet.bodyObject != null) planet.bodyObject.SetActive(bodyActive);
                    root = null; rootSaved = false; bodySaved = false;
                }
                private void RestoreSim()
                {
                    if (simSaved && simT != null) { simT.SetParent(simParent, false); simT.localPosition = simLP; simT.localRotation = simLR; simT.localScale = simLS; }
                    sim = null; simT = null; simSaved = false; simRadius = 0f;
                }
                public void Disable() { disabled = true; RestoreSchematic(); RestoreSim(); RestoreRoot(); }
                public void Dispose(bool unload)
                {
                    RestoreSchematic(); RestoreSim(); RestoreRoot();
                    if (!unload || planet == null || GameMain.localPlanet == planet) return;
                    if (!wasFactoryLoaded && requestedFactory && UnloadFactory != null) try { UnloadFactory.Invoke(planet, null); } catch { }
                    if (!wasLoaded && requestedBody && Unload != null) try { Unload.Invoke(planet, null); } catch { }
                }
            }
        }
    }
}
