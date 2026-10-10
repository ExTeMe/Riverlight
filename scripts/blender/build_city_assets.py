"""Author Riverlight's residential, civic, commercial and landscape library.

Run in Blender through MCP. Every asset is constructed from Blender meshes,
curves, bevel modifiers and materials in its own scene. Existing scenes remain.
REQUESTED_ASSETS can select a batch; all generated assets have editable sources.
Coordinates in the recipes use city X / up Y / depth Z, converted at creation.
"""
import bpy, math, os, json
from pathlib import Path
from mathutils import Vector

def _project_root():
    configured = globals().get('RIVERLIGHT_PROJECT_ROOT') or os.environ.get('RIVERLIGHT_PROJECT_ROOT')
    if configured:
        root = Path(configured).expanduser().resolve()
        if (root / 'assets' / 'catalog-reference.json').is_file():
            return str(root)
        raise RuntimeError('RIVERLIGHT_PROJECT_ROOT must point to the Riverlight repository.')
    origins = [Path.cwd()]
    if globals().get('__file__'):
        origins.insert(0, Path(__file__).resolve().parent)
    if bpy.data.filepath:
        origins.append(Path(bpy.data.filepath).resolve().parent)
    for origin in origins:
        for root in (origin, *origin.parents):
            if (root / 'assets' / 'catalog-reference.json').is_file() and (root / 'package.json').is_file():
                return str(root)
    raise RuntimeError('Open a Riverlight source BLEND or set RIVERLIGHT_PROJECT_ROOT locally before running this script.')

ROOT = _project_root()
CATALOG={x['id']:x for x in json.load(open(os.path.join(ROOT,'assets','catalog-reference.json'),encoding='utf-8'))}
os.makedirs(os.path.join(ROOT,'public','models'),exist_ok=True)
os.makedirs(os.path.join(ROOT,'assets','blender'),exist_ok=True)

def L(x,y,z): return (x,-z,y)
def linear(v): return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def material(hexcolor,role='Solid'):
    name='RL_'+role+'_'+hexcolor.strip('#')
    existing=bpy.data.materials.get(name)
    if existing:return existing
    rgb=tuple(linear(int(hexcolor[i:i+2],16)/255) for i in [1,3,5])
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*rgb,1)
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb,1)
    p.inputs['Roughness'].default_value=.24 if 'Glass' in role else .72
    p.inputs['Metallic'].default_value=.18 if 'Glass' in role or 'Metal' in role else 0
    if role in ['WindowWarm','WindowSoft','Sign','Festival','Light']:
        p.inputs['Emission Color'].default_value=(1,.66,.32,1) if role!='WindowSoft' else (.5,.68,.8,1)
        p.inputs['Emission Strength'].default_value=.4
    return m

class Architect:
    def __init__(self,item):
        self.item=item;self.id=item['id'];self.W=item['w']*4;self.D=item['d']*4;self.objects=[];self.dynamic=[]
        self.scene=bpy.data.scenes.new('RL_Asset_'+self.id);self.scene['riverlight_owned']=True;bpy.context.window.scene=self.scene
        self.scene.unit_settings.system='METRIC';self.scene.render.fps=30;self.scene.frame_start=1;self.scene.frame_end=241
        self.wall=material(item['color'],'Wall');self.white=material('#e4ddcc','Roof');self.stone=material('#c5bca8','Ground');self.dark=material('#3d535c','Metal');self.glass=material('#426a79','Glass');self.wood=material('#9d7251');self.leaf=material('#6f8c5b','Leaf')
    def finish(self,obj,name,m,bevel=0):
        obj.name=self.id.replace('-','_')+'_'+name;obj.data.materials.append(m);self.objects.append(obj)
        if bevel:
            mod=obj.modifiers.new('Crafted edge bevel','BEVEL');mod.width=bevel;mod.segments=2
            obj.modifiers.new('Weighted architectural normals','WEIGHTED_NORMAL')
        return obj
    def box(self,name,x,y,z,w,h,d,m=None,bevel=.025):
        bpy.ops.mesh.primitive_cube_add(size=1,location=L(x,y,z));obj=bpy.context.object;obj.scale=(w,d,h);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        return self.finish(obj,name,m or self.wall,min(bevel,min(w,h,d)*.2))
    def cylinder(self,name,x,y,z,r,h,m=None,rt=None,n=20):
        bpy.ops.mesh.primitive_cone_add(vertices=n,radius1=r,radius2=r if rt is None else rt,depth=h,location=L(x,y,z))
        return self.finish(bpy.context.object,name,m or self.white,.012)
    def sphere(self,name,x,y,z,r,m=None,scale=(1,1,1)):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=r,location=L(x,y,z));obj=bpy.context.object;obj.scale=(scale[0],scale[2],scale[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return self.finish(obj,name,m or self.leaf)
    def mesh(self,name,vertices,faces,m):
        data=bpy.data.meshes.new(name);data.from_pydata([L(*v) for v in vertices],[],faces);data.update();obj=bpy.data.objects.new(name,data);self.scene.collection.objects.link(obj);return self.finish(obj,name,m)
    def curve(self,name,points,r,m):
        data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=1;data.bevel_depth=r;data.bevel_resolution=1
        spline=data.splines.new('POLY');spline.points.add(len(points)-1)
        for point,coords in zip(spline.points,points):point.co=(*L(*coords),1)
        obj=bpy.data.objects.new(name,data);self.scene.collection.objects.link(obj);return self.finish(obj,name,m)
    def rod(self,name,a,b,r,m):return self.curve(name,[a,b],r,m)
    def roof(self,x,y,z,w,d,m=None,rise=1.6):
        verts=[(x-w/2,y,z-d/2),(x+w/2,y,z-d/2),(x,y+rise,z-d/2),(x-w/2,y,z+d/2),(x+w/2,y,z+d/2),(x,y+rise,z+d/2)]
        return self.mesh('Gable_Roof',verts,[(2,1,0),(3,4,5),(0,3,5,2),(2,5,4,1),(0,1,4,3)],m or material('#a76b51','Roof'))
    def label(self,text,x,y,z,width=4):
        self.box('Sign_Backplate',x,y,z,width,.8,.14,self.dark)
        curve=bpy.data.curves.new('Sign_Lettering','FONT');curve.body=text;curve.align_x='CENTER';curve.size=min(.52,width/(len(text)*.7));curve.extrude=.012;curve.bevel_depth=.004
        obj=bpy.data.objects.new(self.id+'_Sign_'+text,curve);self.scene.collection.objects.link(obj);obj.location=L(x,y-.17,z+.09);obj.rotation_euler=(math.pi/2,0,math.pi);self.finish(obj,'Lettering_'+text,material('#f3d69c','Sign'))
        # Blender front faces city +Z (-Y); flip the text to face the street.
        obj.rotation_euler=(math.pi/2,0,0)
    def window(self,x,y,z,w,h,side=False,seed=0):
        rand=abs(math.sin(x*12.8+y*7.2+z*3.1+seed+len(self.id))*437.4)%1
        role='WindowWarm' if rand>.78 else 'WindowSoft' if rand>.68 else 'Glass'
        m=material('#6d7b7a' if role=='WindowWarm' else '#627a84' if role=='WindowSoft' else '#426575',role)
        self.box('Window_Recess',x,y,z,.09 if side else w,h,w if side else .09,m,.012)
        self.box('Window_Sill',x,y-h/2,z,.16 if side else w+.13,.09,w+.13 if side else .16,self.white)
        if w>1.6:self.box('Window_Mullion',x,y,z,.14 if side else .055,h,.055 if side else .14,self.dark)
    def facade(self,x,y,z,w,h,d,step=2.5):
        for f in range(max(1,int(h/step))):
            yy=y+f*step+step*.55;nx=max(1,int(w/1.8));nz=max(1,int(d/1.9))
            for i in range(nx):
                for s in [-1,1]:self.window(x+(i-(nx-1)/2)*w/nx,yy,z+s*(d/2+.055),w/nx*.56,step*.5,seed=f*7+i)
            for i in range(nz):
                for s in [-1,1]:self.window(x+s*(w/2+.055),yy,z+(i-(nz-1)/2)*d/nz,d/nz*.56,step*.5,True,f*11+i)
    def block(self,x,y,z,w,h,d,m=None,windows=True):
        self.box('Building_Volume',x,y+h/2,z,w,h,d,m or self.wall,.09);self.box('Roof_Coping',x,y+h+.08,z,w+.18,.16,d+.18,self.white)
        if windows:self.facade(x,y,z,w,h,d)
    def planter(self,x,y,z,w=1.5,d=.8):
        self.box('Raised_Planter',x,y+.22,z,w,.44,d,self.white,.08);self.box('Hedge',x,y+.57,z,w-.13,.34,d-.13,self.leaf,.1)
    def tree(self,x,z,scale=1,kind='broadleaf',y=0):
        self.cylinder('Tree_Trunk',x,y+1.4*scale,z,.17*scale,2.8*scale,self.wood,rt=.1*scale,n=7)
        if kind=='pine':
            for i in range(3):self.cylinder('Pine_Crown',x,y+(2.4+i*.7)*scale,z,(1.4-i*.27)*scale,2.3*scale,material('#517c68','Leaf'),rt=0,n=8)
        else:
            m=material('#d4aaa9','Leaf') if kind=='cherry' else self.leaf
            for dx,dy,dz,r in [(0,3.4,0,1.4),(-.65,3,.25,.95),(.6,3.2,-.3,.8)]:self.sphere('Tree_Crown',x+dx*scale,y+dy*scale,z+dz*scale,r*scale,m,(1,1.1,1))
    def bench(self,x,z):
        for offset in [-.22,0,.22]:self.box('Bench_Slat',x,.6,z+offset,1.8,.1,.16,self.wood)
        for yy in [.86,1.07]:self.box('Bench_Back',x,yy,z-.28,1.8,.14,.09,self.wood)
        for dx in [-.65,.65]:self.box('Bench_Leg',x+dx,.32,z,.1,.58,.55,self.dark)
    def lamp(self,x,z):
        self.cylinder('Lamp_Post',x,1.8,z,.055,3.6,self.dark,n=8);self.box('Lamp_Arm',x+.28,3.53,z,.65,.08,.1,self.dark);self.box('Lamp_Lantern',x+.5,3.43,z,.42,.11,.24,material('#ffdfaa','Light'))
    def table(self,x,z,umbrella=False,y=0):
        self.cylinder('Cafe_Table',x,y+.87,z,.56,.1,self.wood,n=16);self.cylinder('Table_Leg',x,y+.44,z,.055,.8,self.dark,n=8)
        for dx in [-.8,.8]:self.box('Cafe_Chair',x+dx,y+.47,z,.45,.12,.45,self.wood);self.box('Chair_Back',x+dx,y+.75,z-.19,.45,.55,.08,self.wood)
        if umbrella:self.cylinder('Umbrella_Pole',x,y+1.4,z,.035,2.8,self.white,n=6);self.cylinder('Cafe_Umbrella',x,y+2.87,z,1.3,.65,material('#c87957','Roof'),rt=.08,n=10)
    def balcony(self,x,y,z,w,d=1.2):
        self.box('Balcony_Slab',x,y,z,w,.18,d,self.white)
        self.box('Balcony_Glass',x,y+.38,z+d/2,w,.65,.06,self.glass)
        for s in [-1,1]:self.box('Balcony_Rail',x+s*w/2,y+.38,z,.07,.65,d,self.dark)
    def empty(self,name,point=(0,0,0),dynamic=False):
        obj=bpy.data.objects.new(self.id+'_'+name,None);self.scene.collection.objects.link(obj);obj.location=L(*point)
        if dynamic:obj['riverlight_dynamic']=True;self.dynamic.append(obj)
        return obj
    def parent(self,objects,parent):
        bpy.context.view_layer.update()
        for obj in objects:
            matrix=obj.matrix_world.copy();obj.parent=parent;obj.matrix_world=matrix
    def rotate_loop(self,obj,axis,turns=1):
        obj.rotation_mode='XYZ';obj.rotation_euler[axis]=0;obj.keyframe_insert(data_path='rotation_euler',index=axis,frame=1);obj.rotation_euler[axis]=math.tau*turns;obj.keyframe_insert(data_path='rotation_euler',index=axis,frame=241)
    def build(self):
        t=self.id;W,D=self.W,self.D
        if t not in ['tree','pine','cherry','flowers','bench','lamp','pier']:self.box('Site_Paving',0,.11,0,W-.2,.22,D-.2,self.stone,.08)
        if t in ['cottage','sage-house','rose-house','villa']:
            if t=='cottage':
                self.block(0,.3,-.7,5.4,2.7,4.2);self.roof(0,3.15,-.7,5.9,4.8,material('#ac6249','Roof'));self.box('Chimney',1.4,4,-1.4,.55,1.7,.65,self.wall)
                self.box('Porch_Deck',0,.35,2.3,4.5,.2,1.8,self.white);self.box('Porch_Canopy',0,2.8,2.2,4.7,.16,1.8,self.white)
                for x in [-2,2]:self.cylinder('Porch_Column',x,1.6,2.9,.09,2.3,self.white,n=8)
                self.planter(-2.7,.2,2.7,.6,1.4)
            elif t=='sage-house':
                self.block(0,.3,-.6,4.7,2.3,4.7);self.roof(0,2.15,-.6,6.2,5.3,material('#456b71','Roof'),3.9)
                self.box('Gable_Glass',0,3.2,2.09,2.3,2.8,.1,self.glass);self.box('Gable_Frame',0,3.2,2.17,.09,2.8,.1,self.white);self.box('Timber_Porch',0,.4,2.85,4,.2,1.3,self.wood)
            elif t=='rose-house':
                self.block(-.7,.3,-.7,4.6,3,4.5);self.block(2,.3,.9,2.3,2.5,3.3);self.roof(-.7,3.75,-.7,5.1,5,material('#a46454','Roof'))
                self.cylinder('Bay_Window',-.8,1.5,2,1.12,2.1,self.glass,n=6);self.cylinder('Bay_Roof',-.8,3.1,2,1.3,.9,material('#a46454','Roof'),rt=0,n=6)
            else:
                self.block(-1,.3,-.8,7.7,2.8,4.3);self.block(1,3.25,-1,6.4,2.8,3.2,self.white);self.box('Panoramic_Window',1,4.7,.67,5.8,2.1,.1,self.glass);self.balcony(1,3.18,1.75,6,2.2)
                self.box('Garden_Pool',-3.7,.28,2.2,3.2,.15,2.5,material('#5fa3ab','Glass'))
                for z in [-1.8,-.8,.2]:self.box('Roof_Pergola',-3.6,6.3,z,3.6,.13,.12,self.wood)
            self.tree(W*.36,-D*.33,.48);self.planter(W*.34,.15,D*.34,.7,1.2)
        elif t=='townhouse':
            for i in range(3):
                x=(i-1)*2.35;self.block(x,.3,-.3,2.2,6.3,5.4,material(['#b27355','#ccae81','#997163'][i],'Wall'));self.roof(x,6.9,-.3,2.35,5.6,material('#626d70','Roof'),1)
                self.box('Entry_Stair',x,.34,2.9,1.5,.25,.8,self.white);self.box('Front_Door',x,1.3,2.48,.72,1.8,.1,self.dark)
        elif t in ['apartment','mint-apartment']:
            mint=t=='mint-apartment';h=10.4 if mint else 13
            self.block(-.8 if mint else 0,.3,-.5,4.9 if mint else 6.1,h,4.9)
            if mint:self.block(2.25,.3,.5,2.3,6.1,3.7,self.white)
            for f in range(1,4 if mint else 5):
                x=-.8 if mint else (1.1 if f%2 else -1.1);self.balcony(x,f*2.6+.35,2.45,4.9 if mint else 3.4);self.planter(x-1,f*2.6+.45,2.6,.65,.45)
            self.box('Entrance_Canopy',0,2.5,2.6,3.3,.16,1.2,self.white)
        elif t in ['residence','terrace-tower']:
            h=5.1 if t=='residence' else 6.2
            for level in range(4):
                w=9.8-level*1.7;d=8.2-level*1.1;y=.3+level*h;self.block(-level*.5,y,-level*.35,w,h,d);self.balcony(-level*.5,y+.1,d/2-level*.35+.3,w+.3,1.5)
                for x in [-w*.3,w*.3]:self.planter(x-level*.5,y+.25,d/2-level*.35,1,.7)
            self.tree(-4.8,4.5,.5);self.tree(4.8,4.5,.5)
        elif t=='office':
            self.block(0,.3,0,9.8,3.2,8.7,self.white);self.block(-2.7,3.5,-.7,4.1,23,6);self.block(2.8,3.5,.7,3.5,17,5.3,material('#79959b','Wall'))
            self.box('Skybridge',.1,13,-.4,3.1,2.5,2.8,self.glass);self.box('Skybridge_Roof',.1,14.3,-.4,3.2,.16,3,self.white)
            for x in [-4,-1.4]:self.box('Vertical_Fin',x,14.6,-.7,.18,22,6.2,self.white)
            self.label('OFFICE',0,2.4,4.46,5)
        elif t=='glass-tower':
            self.block(0,.3,0,9.8,2.8,8.8,self.white,False);obj=self.cylinder('Elliptical_Tower',0,20,0,4.2,34,self.glass,rt=3.3,n=40);obj.scale.y=.8
            for f in range(14):
                y=3.4+f*2.5;r=4.2-f*.064;ring=self.cylinder('Tower_Floor_Ring',0,y,0,r+.045,.13,self.white,n=40);ring.scale.y=.8
                for k in range(16):
                    a=k*math.tau/16;x,z=math.sin(a)*r,math.cos(a)*r*.8;self.rod('Tower_Fin',(x,y,z),(x*.986,y+2.36,z*.986),.045,self.dark)
                    if (k*13+f*7)%11>8:self.box('Occupied_Office',x,y+1.1,z,.55,1.05,.14,material('#7d9295','WindowSoft'))
            obj=self.cylinder('Sculpted_Crown',0,38.4,0,3.3,2.8,material('#719398','Roof'),rt=1.6,n=32);obj.scale.y=.8;self.cylinder('Spire',0,41,0,.07,3.5,self.dark,n=8)
        elif t=='hotel':
            self.block(0,.3,0,10,3.1,6.4,self.white);self.block(-.6,3.4,-.7,7.5,17,4.2)
            for x in [-3.3,2.1]:self.box('Hotel_Fin',x,12,-.7,.32,17,4.4,self.white)
            self.balcony(-.6,6.1,2.1,8.1,2);self.box('Rooftop_Pool',3.15,3.6,1.45,2.7,.1,1.65,material('#4f9aa9','Glass'));self.label('HOTEL',-.6,21,1.5,5);self.box('Arrival_Canopy',0,2.6,2.9,4.2,.2,2.1,self.white)
        elif t in ['cafe','bakery','bookshop']:
            books=t=='bookshop';bakery=t=='bakery';h=6.5 if books else 4.9;self.block(0,.3,-1,5.7,h,4.2)
            if books or bakery:self.roof(0,h+.7,-1,6.2,4.8,material('#4c6c73' if books else '#b67552','Roof'))
            self.box('Storefront',0,1.5,1.18,4.9,1.8,.1,material('#85816b','WindowWarm'));self.label('BOOKS' if books else 'BAKERY' if bakery else 'CAFE',0,4 if books else 3.5,1.31,4.5)
            if books:
                for i in range(8):self.box('Book_Spine',-1.7+i*.48,3,1.32,.38,.7+i%3*.15,.17,material(['#b76853','#557c88','#bb9c58'][i%3]))
            else:
                for i in range(10):self.box('Striped_Awning',-2.56+i*.57,2.75,1.7,.57,.16,1.5,material('#e9debf' if i%2 else '#bb6d50' if bakery else '#5c7d69','Roof'))
            self.table(-1.7,2.8,not bakery and not books);self.table(1,2.8);self.planter(-3.2,.2,2,.55,2.1)
        elif t=='market':
            for i,x in enumerate([-3.6,0,3.6]):
                self.box('Market_Counter',x,.8,-1,2.9,1,1.55,material('#a88358','Wall'))
                for dx in [-1.4,1.4]:
                    for z in [-1.8,-.2]:self.cylinder('Stall_Post',x+dx,1.4,z,.07,2.4,self.white,n=6)
                self.roof(x,2.6,-1,3.2,2.3,material('#ba7451' if i%2 else '#668578','Roof'),.6)
                for k in range(8):self.sphere('Market_Produce',x+(k%4-1.5)*.5,1.43,-1+(.35 if k>3 else -.35),.16,material('#bc9950' if k%2 else '#b8684b'))
            self.label('MARKET',0,3.6,.3,4.5);self.bench(-3.4,2.5)
        elif t=='library':
            self.block(0,.3,0,9.7,2.7,8,self.glass,False);self.block(-.4,3,-1,10.2,2.5,5.5,self.wall,False);self.box('Reading_Room_Glass',-.5,4.2,1.8,7.8,1.7,.1,self.glass)
            for i in range(15):self.box('Timber_Facade_Fin',-5+i*.66,4.3,-1,.13,2.5,5.7,self.wood)
            self.balcony(.6,3.02,3.3,7.5,2.6);self.label('LIBRARY',0,2.5,4.1,5.5);self.bench(-3,4.8);self.bench(3,4.8)
        elif t=='museum':
            self.block(0,.3,0,9.6,3,5.3,self.wall,False)
            for x in [-3.2,0,3.2]:
                self.mesh('Sawtooth_Gallery',[(x-1.8,3.4,-3),(x+1.8,3.4,-3),(x+1.8,6.2,-3),(x-1.8,3.4,3),(x+1.8,3.4,3),(x+1.8,6.2,3)],[(0,2,1),(3,4,5),(0,3,5,2),(1,2,5,4)],self.white);self.box('Northlight_Glass',x+1.65,4.7,0,.1,2.45,5.6,self.glass)
            self.box('Museum_Entry',0,1.6,2.72,8,2.2,.1,self.glass);self.label('MUSEUM',0,2.9,2.85,5)
            points=[(-3.5+math.cos(i*math.tau/40)*.7,1.5+math.sin(i*math.tau/40)*.9,3.35+math.sin(i*math.tau/20)*.3) for i in range(41)];self.curve('Courtyard_Sculpture',points,.13,material('#b28b55','Metal'))
        elif t=='school':
            self.block(0,.3,-2,10.5,5,2.8)
            for x in [-4,4]:self.block(x,.3,.8,2.4,3.2,3.1)
            self.box('School_Play_Court',0,.28,1.1,4.8,.06,3.2,material('#ac7960','Ground'));self.box('Court_Centre_Line',0,.32,1.1,.07,.015,3,self.white)
            self.curve('Court_Centre_Circle',[(math.cos(i*math.tau/32)*.65,.33,1.1+math.sin(i*math.tau/32)*.65) for i in range(33)],.027,self.white);self.label('SCHOOL',0,5.2,-.5,5)
            self.cylinder('Flagpole',-2.2,2.7,2.8,.035,5,self.dark,n=6);self.box('School_Flag',-1.7,4.8,2.8,1,.6,.04,material('#d5a056'))
        elif t=='clinic':
            self.block(0,.3,-.55,5.8,5.7,5.3,self.wall);red=material('#bd7663','Sign');self.box('Medical_Cross_H',0,5,2.2,1.6,.42,.1,red);self.box('Medical_Cross_V',0,5,2.22,.42,1.6,.1,red)
            self.box('Clinic_Canopy',0,2.65,2.2,5.1,.18,1.7,material('#77a0a3','Roof'));self.label('CLINIC',0,3.4,2.24,3.8)
        elif t=='clocktower':
            self.block(0,.3,0,5.4,2,5.4);self.block(0,2.3,0,3.4,9,3.4,self.wall,False);self.box('Belfry_Cornice',0,10.5,0,4.1,.35,4.1,self.white)
            for s in [-1,1]:
                face=self.cylinder('Clock_Dial',0,9,s*1.8,.92,.13,material('#dccda5','WindowSoft'),n=32);face.rotation_euler.x=math.pi/2
                self.box('Clock_Hour_Hand',.15,9,s*1.91,.5,.09,.1,self.dark);self.box('Clock_Minute_Hand',0,9.23,s*1.91,.08,.65,.1,self.dark)
            self.cylinder('Clock_Spire',0,13.1,0,2.8,4.2,material('#547b76','Roof'),rt=0,n=4);self.cylinder('Clock_Finial',0,16,0,.07,1.8,self.dark,n=8)
        elif t in ['park','plaza','grove','garden']:
            self.box('Garden_Lawn',0,.26,0,W-.65,.14,D-.65,material('#8fa47c','Ground'));self.box('Garden_Walk_X',0,.35,0,W-.25,.06,1,self.stone);self.box('Garden_Walk_Z',0,.35,0,1,.06,D-.25,self.stone)
            if t=='plaza':
                self.cylinder('Fountain_Basin',0,.6,0,2.8,.6,self.white,n=40);self.cylinder('Fountain_Water',0,.93,0,2.5,.06,material('#6aa6a9','Glass'),n=40);self.cylinder('Fountain_Centre',0,1.7,0,.4,1.5,self.white,n=16);self.cylinder('Fountain_Tier',0,2.4,0,1.2,.18,self.white,n=24)
                root=self.empty('Fountain_Jets',(0,0,0),True)
                for i in range(8):
                    a=i*math.tau/8;x,z=math.sin(a),math.cos(a);jet=self.curve('Fountain_Jet',[(x,.95,z),(x*.85,1.8,z*.85),(x*.5,2.1,z*.5)],.035,material('#a4cbcf','Glass'));self.parent([jet],root)
                for frame,scale in [(1,1),(61,1.15),(121,.9),(181,1.12),(241,1)]:root.scale.z=scale;root.keyframe_insert(data_path='scale',index=2,frame=frame)
            elif t=='garden':
                for x in [-2,2]:
                    for z in [-2,2]:self.flowers(x,z)
            for x,z in [(-W*.31,-D*.31),(W*.31,D*.31),(-W*.31,D*.31),(W*.31,-D*.31)]:
                if t!='garden':self.tree(x,z,1 if t=='grove' else .68,'cherry' if t=='park' else 'broadleaf')
            self.bench(-W*.25,0);self.lamp(W*.38,-D*.36)
        elif t in ['tree','pine','cherry']:self.tree(0,0,1,t)
        elif t=='flowers':self.flowers(0,0)
        elif t=='bench':self.bench(0,0)
        elif t=='lamp':self.lamp(0,0)
        elif t=='pier':
            self.box('Landing_Stem',0,.22,0,2.2,.35,7.6,self.wood);self.box('Landing_Head',0,.22,-2.5,7.5,.35,2,self.wood)
            for z in [-3,-1,1,3]:self.box('Deck_Plank',0,.405,z,2.15,.015,.035,self.white)
            for x in [-3.3,3.3]:self.cylinder('Mooring_Pile',x,-.1,-2.5,.13,1.6,self.dark,n=10)
            self.box('Ferry_Shelter_Roof',0,2.7,1.8,2.6,.18,2.6,material('#7b9997','Roof'))
            for x in [-1,1]:self.cylinder('Shelter_Post',x,1.5,2.6,.07,2.3,self.white,n=8)
            self.label('FERRY',0,2.3,3.12,2);self.lamp(-.75,-2.6)
        elif t=='amusement':self.amusement()
        else:raise ValueError('Missing bespoke Blender recipe: '+t)
        self.scene.frame_set(1)
    def flowers(self,x,z):
        self.box('Flowerbed',x,.2,z,2.4,.35,1.4,self.stone);self.box('Plant_Soil',x,.4,z,2.2,.12,1.2,self.leaf)
        for i in range(12):self.sphere('Flower_Bloom',x+(i%4-1.5)*.5,.65,z+(i//4-1)*.35,.16,material('#d9b45f' if i%2 else '#b87371'))
    def amusement(self):
        self.cylinder('Wheel_Plaza',-3.5,.3,-2.2,7.5,.12,material('#d4c39f','Ground'),n=48)
        for z in [-3.4,-1]:
            for dx in [-3,3]:self.rod('Wheel_A_Frame',(-3.5+dx,.35,z),(-3.5,9,z),.18,self.white)
        root=self.empty('Wheel_Assembly',(-3.5,9,-2.2),True);rotor=self.empty('Wheel_Rotor',(-3.5,9,-2.2));self.parent([rotor],root)
        pieces=[]
        for z in [-2.65,-1.75]:pieces.append(self.curve('Wheel_Rim',[(-3.5+math.cos(i*math.tau/64)*7,9+math.sin(i*math.tau/64)*7,z) for i in range(65)],.105,self.white))
        for i in range(12):
            a=i*math.tau/12;x,y=-3.5+math.cos(a)*7,9+math.sin(a)*7
            pieces.append(self.rod('Wheel_Spoke',(-3.5,9,-2.2),(x,y,-2.2),.055,self.dark))
            cabin=self.empty('Gondola', (x,y,-2.2));self.parent([cabin],rotor);before=len(self.objects)
            self.box('Gondola_Body',x,y-.65,-2.2,1.5,1.05,1.35,material(['#c88765','#709ca0','#cfaa64','#a48795'][i%4]));self.box('Gondola_Windows',x,y+.13,-2.2,1.35,.65,1.2,self.glass);self.box('Gondola_Canopy',x,y+.55,-2.2,1.65,.14,1.5,self.white);self.parent(self.objects[before:],cabin)
            self.rotate_loop(cabin,1,-1)
            for k in range(4):
                aa=a+k*math.tau/48;pieces.append(self.sphere('Wheel_Festoon',-3.5+math.cos(aa)*7,9+math.sin(aa)*7,-1.64,.09,material('#edcc8b' if i%2 else '#8bb6bf','Festival')))
        self.parent(pieces,rotor);self.rotate_loop(rotor,1,1)
        before=len(self.objects);carousel=self.empty('Carousel',(6.1,0,3.1),True)
        self.cylinder('Carousel_Base',6.1,.5,3.1,3.25,.4,material('#bb8872'),n=32);self.cylinder('Carousel_Centre',6.1,2.2,3.1,.23,3.8,self.white,n=16);self.cylinder('Carousel_Canopy',6.1,4.8,3.1,3.6,1.6,material('#c17d63','Roof'),rt=.05,n=16);self.cylinder('Carousel_Fascia',6.1,4.05,3.1,3.6,.25,material('#edc88a','Festival'),n=32)
        for i in range(8):
            a=i*math.tau/8;x,z=6.1+math.sin(a)*2.3,3.1+math.cos(a)*2.3;self.cylinder('Carousel_Pole',x,2.2,z,.045,3.6,self.dark,n=8)
            self.sphere('Carousel_Horse',x,1.5,z,.5,self.white,(1.3,.7,.6));self.box('Horse_Neck',x+.36,1.9,z,.3,.8,.3,self.white);self.sphere('Horse_Head',x+.5,2.25,z,.22,self.white,(1.5,.7,.7))
            for dx in [-.32,.32]:self.box('Horse_Leg',x+dx,1.02,z,.1,.55,.1,self.wood)
        self.parent(self.objects[before:],carousel);self.rotate_loop(carousel,2,1)
        self.block(-7,.3,7,3,2.5,2.6,material('#779b9c','Wall'),False);self.label('PLAY',-1,3,8.65,5)
        for x in [-4,2]:self.cylinder('Entrance_Post',x,1.8,8.6,.1,3.4,self.white,n=8)
        self.box('Entrance_Lintel',-1,3.6,8.6,6.3,.15,.3,material('#d2b173','Festival'));self.table(7,7,True);self.bench(6,-5.8);self.planter(8,.3,-5.4,3,1)
    def export(self):
        self.scene.frame_set(1);bpy.context.view_layer.update()
        # Curves and text remain modeled with editable mesh results in the library.
        for obj in list(self.objects):
            if obj.type in ['FONT','CURVE']:
                bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj;bpy.ops.object.convert(target='MESH')
        filename=os.path.join(ROOT,'public','models',self.id+'.glb')
        bpy.ops.export_scene.gltf(filepath=filename,export_format='GLB',use_active_scene=True,export_apply=True,export_extras=True,export_animations=bool(self.dynamic),export_animation_mode='SCENE',export_frame_range=True,export_frame_step=8,export_cameras=False,export_lights=False)
        # A second export preserves the Blender-authored silhouette at distance.
        bpy.ops.object.select_all(action='DESELECT')
        omit=['Window_Recess','Window_Sill','Window_Mullion','Lettering','Flower_Bloom','Market_Produce','Bench_Slat','Bench_Leg','Chair_Back','Cafe_Chair','Wheel_Festoon','Occupied_Office']
        modifiers=[]
        for obj in self.scene.objects:
            obj.select_set(not any(token in obj.name for token in omit))
            for mod in obj.modifiers:
                if mod.type in ['BEVEL','WEIGHTED_NORMAL']:
                    modifiers.append((mod,mod.show_viewport));mod.show_viewport=False
        lod=os.path.join(ROOT,'public','models',self.id+'_lod.glb')
        bpy.ops.export_scene.gltf(filepath=lod,export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
        for mod,visible in modifiers:mod.show_viewport=visible
        return {'id':self.id,'objects':len(self.scene.objects),'bytes':os.path.getsize(filename),'animated':bool(self.dynamic)}

requested=globals().get('REQUESTED_ASSETS',[key for key in CATALOG if key not in ['mall','road','bridge','path']])
generated=[]
for key in requested:
    author=Architect(CATALOG[key]);author.build();generated.append(author.export())
if generated:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets','blender','riverlight-city-library.blend'))
result={'generated':generated,'source':os.path.join(ROOT,'assets','blender','riverlight-city-library.blend')}
