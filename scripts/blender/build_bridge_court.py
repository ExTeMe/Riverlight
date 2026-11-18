"""Build the hillside courtyard home in metres. Run with background Blender's --python."""
from math import sin, cos, pi
from pathlib import Path
import struct
import tempfile
import zlib

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "public" / "models"
SOURCES = ROOT / "assets" / "blender"
COLORS = {
    "Brick": "a7654d", "BrickEdge": "be795a", "BrickDark": "8e5745", "Mortar": "cfb193",
    "Slate": "576a6d", "Zinc": "687b80", "Cedar": "a87c54", "Oak": "be946a",
    "Beam": "76583f", "Bronze": "514b3e", "Plaster": "e4d8b9", "Chalk": "ede2cd",
    "Linen": "d9c7a7", "Sage": "75867b", "Enamel": "c6d3bf", "Ceramic": "cf885c",
    "Stone": "ad9f88", "Capstone": "c5b79e", "Paving": "c3b39b", "Earth": "88775b",
    "Ground": "a2a17b", "Leaf": "758655", "LeafSun": "9aaa70", "LeafDark": "596e50",
    "Clay": "ad715a", "Glass": "b5d4d1", "Light": "ffe0a2", "Water": "6b8a89",
}
MAT = {}
NEAR = True


def palette():
    MAT.clear()
    rng=np.random.default_rng(17241)
    for key,h in COLORS.items():
        rgb=np.array([int(h[i:i+2],16)/255 for i in (0,2,4)])
        linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
        mat=bpy.data.materials.new("RL_"+({"Plaster":"Wall_Lime","Brick":"Wall_Brick","Stone":"Wall_Stone","Zinc":"Roof_Zinc","Slate":"Roof_Slate"}.get(key,key)))
        mat.diffuse_color=(*linear,1)
        mat.use_nodes=True
        bs=mat.node_tree.nodes.get("Principled BSDF")
        bs.inputs["Base Color"].default_value=(*linear,1)
        bs.inputs["Roughness"].default_value=.76
        if key in ("Zinc","Bronze"):
            bs.inputs["Metallic"].default_value=.47
            bs.inputs["Roughness"].default_value=.46
        if key=="Glass":
            bs.inputs["Alpha"].default_value=.19
            bs.inputs["Roughness"].default_value=.18
            mat.surface_render_method="DITHERED"
        if key=="Light":
            bs.inputs["Emission Color"].default_value=(*linear,1)
            bs.inputs["Emission Strength"].default_value=.48
        MAT[key]=mat
        if key in ("Brick","Stone","Oak","Cedar","Paving","Slate","Clay"):
            # One metre-scale repeating material. Joints and grain retain their real sizes on every wall.
            size=256
            yy,xx=np.mgrid[0:size,0:size]
            if key in ("Oak","Cedar"):
                grain=np.sin(xx*.67+1.4*np.sin(yy*.022+xx*.05))*.024+np.sin(xx*.22+np.sin(yy*.024))*.041
                shade=1+grain+rng.normal(0,.014,(size,size))
            else:
                cols,rows={"Brick":(6,16),"Stone":(3,7),"Paving":(4,5),"Slate":(6,8),"Clay":(8,10)}[key]
                row=(yy*rows)//size
                xcell=xx*cols/size+(row%2)*.5
                if key=="Stone": xcell+=.032*np.sin(yy*.31)+.1*np.sin(row*1.8)
                fx,fy=xcell%1,(yy*rows/size)%1
                chips=rng.uniform(-.083,.083,(rows,cols))
                shade=1+chips[row,np.floor(xcell).astype(int)%cols]+rng.normal(0,.017,(size,size))
                seam=(fx<.037)|(fy<(.085 if key=="Brick" else .061))
                shade[seam]=1.27 if key=="Brick" else .82
            pixels=np.clip(rgb[None,None,:]*shade[:,:,None]*255,0,255).astype(np.uint8)
            def chunk(tag,data):
                return struct.pack(">I",len(data))+tag+data+struct.pack(">I",zlib.crc32(tag+data))
            data=b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">2I5B",size,size,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(b"".join(b"\0"+row.tobytes() for row in pixels),9))+chunk(b"IEND",b"")
            with tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/(key+".png")
                path.write_bytes(data)
                img=bpy.data.images.load(str(path))
                img.filepath="//"+key+".png"
                img.pack(data=data, data_len=len(data))
                for packed in img.packed_files:
                    packed.filepath=img.filepath
            tex=mat.node_tree.nodes.new("ShaderNodeTexImage")
            tex.image=img
            mat.node_tree.links.new(tex.outputs["Color"],bs.inputs["Base Color"])


def mesh(name,verts,faces,mat,bevel=0):
    data=bpy.data.meshes.new(name)
    data.from_pydata(verts,[],faces)
    data.update()
    ob=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(ob)
    data.materials.append(MAT[mat])
    uv=data.uv_layers.new(name="Metres")
    for face in data.polygons:
        axis=max(range(3),key=lambda i:abs(face.normal[i]))
        a,b=[(1,2),(0,2),(0,1)][axis]
        for loop in face.loop_indices:
            p=data.vertices[data.loops[loop].vertex_index].co
            uv.data[loop].uv=(p[a]/1.8,p[b]/1.8)
    if NEAR and bevel:
        mod=ob.modifiers.new("Eased edge","BEVEL")
        mod.width=bevel
        mod.segments=2 if bevel>.036 else 1
        ob.modifiers.new("Plane normals","WEIGHTED_NORMAL")
    return ob


def block(name,x,y,z,w,d,h,mat,bevel=.014):
    """Placed by centre in plan and underside in elevation."""
    a,b=w/2,d/2
    ob=mesh(name,[(-a,-b,0),(a,-b,0),(a,b,0),(-a,b,0),(-a,-b,h),(a,-b,h),(a,b,h),(-a,b,h)],
        [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,bevel)
    ob.location=(x,y,z)
    return ob


def bar(name,p,q,width,depth,mat):
    p,q=Vector(p),Vector(q)
    ob=block(name,0,0,0,width,depth,(q-p).length,mat,.009)
    ob.location=p
    ob.rotation_euler=(q-p).to_track_quat("Z","Y").to_euler()
    return ob


def panel(name,top,thick,mat):
    n=len(top)
    pts=[(x,y,z-thick) for x,y,z in top]+top
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,pts,faces,mat,.012)


def pot(name,x,y,z,profile,mat,n=14):
    vs=[(x+r*cos(2*pi*j/n),y+r*sin(2*pi*j/n),z+h) for h,r in profile for j in range(n)]
    faces=[tuple(reversed(range(n)))]
    for i in range(len(profile)-1):
        for j in range(n):
            k=(j+1)%n
            faces.append((i*n+j,i*n+k,(i+1)*n+k,(i+1)*n+j))
    faces.append(tuple(range(len(vs)-n,len(vs))))
    return mesh(name,vs,faces,mat)


def marker(name,p):
    ob=bpy.data.objects.new(ID+"_"+name,None)
    bpy.context.collection.objects.link(ob)
    ob.location=p


def leaves(name,clusters,mat):
    # Bunches are open sprays of individual leaves, with daylight between them.
    vs,fs=[],[]
    for x,y,z,r,ang in clusters:
        a=Vector((cos(ang)*r,sin(ang)*r,r*.34))
        b=Vector((-sin(ang)*r*.31,cos(ang)*r*.31,0))
        c=Vector((x,y,z))
        first=len(vs)
        vs.extend([c,c+a*.44+b,c+a+Vector((0,0,-.09*r)),c+a*.44-b,c+a*.49+Vector((0,0,.11*r))])
        fs.extend([(first+i,first+(i+1)%4,first+4) for i in range(4)])
    if vs:
        mesh(name,vs,fs,mat)
        MAT[mat].use_backface_culling=False


def shrub(x,y,z,s=1,seed=0,container=True):
    rng=np.random.default_rng(seed)
    if container:
        pot("Thrown garden pot",x,y,z,[(0,.22*s),(.05*s,.25*s),(.48*s,.32*s),(.54*s,.33*s),(.54*s,.29*s)],"Ceramic")
        z+=.49*s
    sprays=[[],[],[]]
    for i in range(11 if NEAR else 5):
        ang=i*2.39996
        r=(.16+rng.random()*.35)*s
        a=Vector((x,y,z))
        b=a+Vector((cos(ang)*r,sin(ang)*r,s*(.4+.55*rng.random())))
        bar("Herb stem",a,b,.017*s,.02*s,"Beam")
        for j in range(7 if NEAR else 3):
            p=a.lerp(b,.28+.72*j/7)
            sprays[(j+i)%3].append((*p,.24*s,ang+j*2.3))
    for group,mat in zip(sprays,["Leaf","LeafDark","LeafSun"]):
        leaves("Garden herb leaves",group,mat)


def pendant(x,y,top,bottom,r):
    bar("Lamp flex",(x,y,top),(x,y,bottom+.2),.018,.018,"Bronze")
    pot("Spun enamel shade",x,y,bottom,[(0,r),(.04,r),(.16,r*.47),(.21,.06)],"Enamel")
    pot("Milk glass diffuser",x,y,bottom-.036,[(0,r*.65),(.042,r*.9)],"Light")


def kitchen(x,y,z,mat):
    block("Lower kitchen joinery",x,y,z,2.76,.69,.88,mat)
    block("Kitchen stone slab",x,y,z+.88,2.84,.76,.085,"Capstone")
    block("Wall shelf",x,y+.13,z+1.54,2.05,.34,.055,"Oak")
    if NEAR:
        for dx in [-.94,-.31,.31,.94]:
            block("Inset cabinet face",x+dx,y-.353,z+.16,.59,.035,.64,mat)
            block("Pull",x+dx+.18,y-.389,z+.66,.10,.048,.027,"Bronze")
        block("Sink rim",x-.46,y,z+.97,.63,.46,.016,"Enamel")
        block("Sink basin",x-.46,y,z+.985,.53,.36,.012,"Zinc")
        bar("Tap riser",(x-.44,y+.18,z+.97),(x-.44,y+.18,z+1.26),.032,.032,"Bronze")
        bar("Tap spout",(x-.44,y+.18,z+1.26),(x-.44,y+.03,z+1.26),.032,.032,"Bronze")
        for i in range(4):
            pot("Glazed spice jar",x-.72+i*.42,y+.14,z+1.60,[(0,.074),(.15,.09),(.18,.067)],"Ceramic" if i%2 else "Chalk")
        block("Bread board",x+.74,y,z+.968,.53,.29,.045,"Oak",.037)


def chair(x,y,z,angle=0):
    for dx in [-.18,.18]:
        for dy in [-.17,.17]:
            block("Chair leg",x+dx,y+dy,z,.047,.049,.45,"Beam")
    block("Woven seat",x,y,z+.43,.48,.45,.065,"Oak",.029)
    sign=1 if angle==0 else -1
    for dx in [-.18,.18]:
        bar("Back stile",(x+dx,y+sign*.17,z+.46),(x+dx,y+sign*.22,z+.86),.045,.048,"Beam")
    block("Curved chair back",x,y+sign*.22,z+.72,.46,.07,.15,"Oak",.035)


def bed(x,y,z):
    block("Platform",x,y,z,1.60,2.14,.31,"Oak")
    block("Mattress",x,y,z+.29,1.56,2.09,.20,"Linen",.065)
    block("Woven bedcover",x,y-.26,z+.49,1.54,1.51,.085,"Sage",.045)
    for dx in [-.39,.39]:
        block("Pillow",x+dx,y+.72,z+.5,.64,.43,.13,"Chalk",.057)

def glazed(name,x,y,z,width,height,posts=3):
    block(name+" glass",x,y,z,width,.038,height,"Glass",0)
    for i in range(posts+1):
        block(name+" mullion",x-width/2+width*i/posts,y,z,.062,.105,height,"Bronze")
    for h in [0,height*.69,height]:
        block(name+" rail",x,y,z+h,width+.06,.105,.069,"Bronze")


def multi_stem_tree(x,y,z,height):
    rng=np.random.default_rng(192)
    foliage=[[],[],[]]
    for stem in range(4):
        a=stem*2.40
        tip=Vector((x+cos(a)*height*.25,y+sin(a)*height*.22,z+height*(.77+.055*stem)))
        base=Vector((x+cos(a)*.08,y+sin(a)*.08,z))
        fork=base.lerp(tip,.56)+Vector((.08,-.07,0))
        bar("Serviceberry trunk",base,fork,.10,.11,"Beam")
        bar("Serviceberry leader",fork,tip,.062,.067,"Beam")
        for j in range(6 if NEAR else 4):
            ang=a+j*2.17
            start=fork.lerp(tip,.14+j*.13)
            twig=start+Vector((cos(ang)*.72,sin(ang)*.72,.24+j*.024))
            bar("Fine branch",start,twig,.032,.035,"Beam")
            for k in range(22 if NEAR else 9):
                leaf=twig+Vector((rng.uniform(-.37,.37),rng.uniform(-.35,.35),rng.uniform(-.24,.29)))
                foliage[(j+k)%3].append((*leaf,.25+rng.random()*.14,ang+k*2.4))
    for pts,mat in zip(foliage,["Leaf","LeafSun","LeafDark"]):
        leaves("Serviceberry foliage",pts,mat)


def stair_hall():
    # The two flights fit the opening between the bedroom slab and the east wall.
    low, upper = .30, 2.82
    rise = (upper-low)/14
    going = .29
    front = 2.96
    turn = front+7*going
    for flight,(x,direction) in enumerate([(1.06,1),(2.23,-1)]):
        start_y = front if flight==0 else turn
        start_z = low + 7*flight*rise
        for i in range(7):
            y = start_y+direction*(i+.5)*going
            top = start_z+(i+1)*rise
            block("Interior oak tread",x,y,top-.065,1.05,going+.016,.065,"Oak")
            block("Closed stair riser",x,y-direction*(going/2-.021),top-rise,1.03,.042,rise,"Cedar")
        for side in [-.48,.48]:
            bar("Housed stair stringer",(x+side,start_y,start_z+.016),
                (x+side,start_y+direction*7*going,start_z+7*rise+.016),.082,.13,"Beam")
        rail_x = x-.52 if flight==0 else x+.52
        for i in [0,3,6]:
            block("Stair baluster",rail_x,start_y+direction*(i+.5)*going,
                  start_z+(i+1)*rise,.045,.045,.88,"Bronze")
        bar("Stair handrail",(rail_x,start_y,start_z+.98),
            (rail_x,start_y+direction*7*going,start_z+7*rise+.98),.065,.065,"Oak")
    block("Half landing",1.65,turn+.45,low+7*rise-.14,2.26,.91,.14,"Cedar")
    for x in [.61,2.68]:
        block("Landing support",x,turn+.61,low,.12,.13,7*rise-.14,"Beam")
    # Landing-level glazing gives the lower dining room borrowed daylight.
    glazed("Landing daylight",1.62,5.92,2.14,2.24,2.72,2)
    block("Gallery edge beam",-.01,3.99,2.45,.18,3.83,.24,"Beam")
    for y in [3.15,4.38,5.66]:
        block("Gallery guard picket",.43,y,2.82,.048,.048,.92,"Bronze")
    bar("Gallery cap",(.43,3.08,3.74),(.43,5.77,3.74),.069,.063,"Oak")
    for x in [.54,1.48]:
        block("Landing lip picket",x,2.88,2.82,.05,.05,.93,"Bronze")
    bar("Landing lip rail",(.47,2.88,3.75),(1.63,2.88,3.75),.063,.063,"Oak")


def upper_roof_height(y):
    return 5.40+(y-1.03)*.93/5.45


def sloping_wall(name,x,y0,y1,width,z,mat):
    verts=[(xx,yy,zz) for xx in [x-width/2,x+width/2]
           for yy,zz in [(y0,z),(y1,z),(y1,upper_roof_height(y1)-.24),(y0,upper_roof_height(y0)-.24)]]
    mesh(name,verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,.014)


def domestic_rooms():
    # The wet room has an entrance from the western living room and a glazed high vent.
    block("Bath front partition",-5.51,2.20,.31,2.17,.14,2.42,"Plaster")
    block("Bath return",-4.48,4.35,.31,.15,1.98,2.45,"Plaster")
    block("Bath door pocket",-4.48,3.19,.31,.15,.28,2.45,"Plaster")
    block("Bath door header",-4.48,2.78,2.37,.16,1.13,.39,"Cedar")
    block("Sliding bath door",-4.55,3.60,.31,.075,.94,2.06,"Oak")
    block("Shower tray",-5.87,4.75,.31,1.04,.99,.085,"Capstone")
    block("Washstand",-5.89,2.69,.31,.88,.58,.79,"Cedar")
    pot("Wash basin",-5.89,2.71,1.10,[(0,.16),(.12,.26),(.14,.24),(.05,.16)],"Chalk")
    pot("WC pan",-5.03,4.20,.31,[(0,.19),(.30,.23),(.38,.29),(.41,.25)],"Chalk")
    block("Cistern",-5.03,4.47,.69,.48,.20,.40,"Chalk",.04)
    # Kitchen, breakfast table and landing are visible one behind the other.
    block("Fridge",-3.19,5.31,.30,.75,.77,1.86,"Enamel",.042)
    block("Fridge pull",-2.92,4.91,1.18,.035,.045,.51,"Bronze")
    block("Hob",-.32,5.43,1.275,.59,.48,.022,"Bronze")
    pot("Covered soup pot",-.32,5.45,1.30,[(0,.13),(.17,.17),(.20,.17),(.22,.13)],"Enamel")
    if NEAR:
        block("Oven window",-.32,5.055,.58,.53,.035,.34,"Bronze")
        block("Folded tea towel",-.70,5.02,.94,.27,.03,.25,"Linen")
        block("Serving cloth",-1.42,2.87,1.153,.48,.82,.012,"Sage")
        for x in [-2.04,-.85]:
            pot("Breakfast plate",x,2.76,1.154,[(0,.11),(.025,.17),(.037,.16),(.024,.12)],"Chalk")
            pot("Coffee cup",x+.17,3.06,1.155,[(0,.047),(.078,.067),(.083,.058),(.02,.045)],"Enamel")
        pot("Bread basket",-1.41,2.96,1.17,[(0,.12),(.09,.20),(.10,.17),(.05,.14)],"Oak")
        for i in range(3):
            pot("Bread roll",-1.50+i*.085,2.97,1.235,[(0,.045),(.04,.063),(.075,.031)],"Ceramic")


def stone_house():
    block("Valley floor",0,0,-.10,15.40,14.85,.17,"Paving")
    # The uphill approach, bridge, switchback stair and lower court share one section.
    block("East embankment",5.73,.32,.07,3.32,11.94,2.46,"Stone")
    block("East garden terrace",5.73,.32,2.53,3.37,12.02,.14,"Ground")
    block("Western lower wing",-4.65,1.82,.08,4.49,7.78,.23,"Capstone")
    block("Western outer wall",-6.71,1.82,.31,.46,7.76,2.95,"Stone")
    block("Private return",-4.65,5.47,.31,4.51,.40,2.98,"Stone")
    block("Western hearth pier",-2.60,-1.54,.31,.50,.83,2.65,"Stone")
    block("West window seat",-4.82,-1.69,.31,3.27,.65,.48,"Stone")
    glazed("Corner reading window",-4.82,-1.87,.82,3.22,2.04,2)
    panel("Reading room stone roof",[(-7.19,-2.51,3.85),(-2.02,-2.51,3.08),(-2.02,1.23,3.08),
          (-2.61,1.23,3.17),(-2.61,5.94,3.17),(-7.19,5.94,3.85)],.21,"Slate")
    # Loft on the far side of the open court, with the lower loggia recessed below.
    block("Hall plinth",-.50,3.71,.07,7.71,4.87,.23,"Capstone")
    block("North masonry spine",-1.13,5.99,.29,3.05,.38,5.70,"Stone")
    block("Kitchen return",-3.51,5.68,.30,1.77,.30,2.75,"Stone")
    block("Landing window sill",1.80,5.99,.29,2.96,.38,1.85,"Stone")
    block("Landing window lintel",1.80,5.99,4.90,2.96,.38,1.09,"Stone")
    sloping_wall("Bedroom east wall",3.10,3.06,6.17,.48,.30,"Stone")
    block("South bay pier",-1.63,1.51,.30,.59,.66,2.35,"Stone")
    block("Court pier",2.99,1.51,.30,.59,.68,2.35,"Stone")
    block("Bedroom floor",-1.10,3.69,2.60,3.05,4.79,.22,"Oak")
    block("Bridge hall floor",1.80,2.125,2.60,2.75,1.67,.22,"Oak")
    stair_hall()
    block("Bedroom low sill",-1.20,1.51,2.82,2.76,.31,.61,"Stone")
    glazed("Loft glazing",-1.20,1.54,3.43,2.73,1.83,3)
    glazed("Gallery street window",1.68,1.54,2.86,2.91,2.40,3)
    panel("Upper roof", [(-3.03,1.03,5.40),(3.65,1.03,5.40),(3.65,6.48,6.33),(-3.03,6.48,6.33)],.24,"Zinc")
    if NEAR:
        for i in range(12):
            xx=-2.90+i*.58
            bar("Standing seam",(xx,1.04,5.418),(xx,6.46,6.346),.032,.032,"Zinc")
    block("Eaves gutter",.31,1.00,5.16,6.75,.15,.11,"Bronze")
    bar("Rainwater stack",(-2.82,1.02,5.23),(-2.82,1.02,3.19),.085,.085,"Zinc")
    block("Side chimney",-6.01,.35,.29,.97,1.25,4.65,"Stone")
    block("Chimney weathering",-6.01,.35,4.94,1.10,1.38,.16,"Capstone")
    block("Recessed iron hearth",-5.48,.35,.50,.09,.80,.68,"Bronze")
    bed(-1.40,4.57,2.82)
    sloping_wall("Bedroom west wall",-2.54,1.36,5.96,.17,2.82,"Plaster")
    block("Bedroom east lining",.31,4.86,2.82,.16,1.95,2.44,"Plaster")
    block("Bedroom screen rail",-1.49,3.38,2.82,1.90,.13,.11,"Oak")
    block("Bedroom screen head",-1.49,3.38,4.98,1.90,.13,.11,"Oak")
    for i in range(11):
        fin=block("Angled privacy fin",-2.37+i*.17,3.38,2.93,.066,.19,2.05,"Cedar")
        fin.rotation_euler.z=.38
    block("Bedside shelf",-2.25,4.99,3.23,.38,.36,.07,"Oak")
    block("Sliding door track",.72,1.78,2.49,3.95,.11,.095,"Bronze")
    for i in range(3):
        x=2.28-i*.039
        block("Parked patio glass",x,1.85+i*.066,.32,.93,.026,2.14,"Glass",0)
        block("Patio meeting stile",x-.46,1.85+i*.066,.32,.039,.048,2.14,"Bronze")
    kitchen(-1.24,5.42,.30,"Cedar")
    domestic_rooms()
    block("Refectory table top",-1.42,2.87,1.05,2.20,.79,.10,"Oak",.037)
    for dx in [-.76,.76]:
        block("Slab table leg",-1.42+dx,2.87,.30,.19,.61,.75,"Stone")
    for dx in [-.67,.32]:
        chair(-1.42+dx,2.19,.30,pi)
    pendant(-1.40,2.89,2.59,1.99,.26)
    marker("Light",(-1.40,2.89,1.94))
    block("Court threshold",.14,.92,.07,2.78,.74,.115,"Capstone")
    block("Dining threshold",.14,1.14,.185,2.78,.27,.113,"Capstone")
    # Bridge follows the long edge of the sunken court and returns to the bedroom door.
    block("Bridge deck",3.72,2.56,2.55,2.45,1.19,.17,"Oak")
    for y in [2.01,3.11]:
        bar("Bridge steel stringer",(2.49,y,2.52),(4.95,y,2.52),.11,.17,"Bronze")
        bar("Bridge handrail",(2.49,y,3.55),(4.95,y,3.55),.062,.07,"Bronze")
        for i in range(5):
            block("Bridge picket",2.5+i*.61,y,2.70,.035,.035,.85,"Bronze")
    # Exposed entrance on the east wall alongside the bridge.
    for yy in [1.89,3.11]:
        block("Bridge door jamb",3.01,yy,2.78,.19,.095,2.17,"Cedar")
    block("Bridge lintel",3.01,2.50,4.95,.21,1.35,.16,"Cedar")
    block("Open bridge door",2.52,1.93,2.82,1.03,.065,2.09,"Sage")
    block("Bridge threshold",3.36,2.55,2.721,.37,1.17,.096,"Oak")
    block("Landing flagstone",4.72,2.55,2.67,1.41,1.46,.06,"Capstone")
    for i in range(15):
        block("Side hill stair",3.46,-5.52+i*.308,.07,1.18,.335,(i+1)*.172,"Stone")
        if NEAR:
            block("Stone tread nosing",3.46,-5.61+i*.308,.07+(i+1)*.172,1.22,.17,.048,"Capstone")
    block("Stair return landing",3.58,-.89,2.49,1.59,1.12,.17,"Capstone")
    for i in range(7):
        block("Uphill path",5.16,-.86+i*.53,2.67,.96,.46,.055,"Paving")
    # A pergola and fireplace give the bottom court a second living room.
    for xx in [-5.83,-2.84]:
        block("Pergola footing",xx,-4.17,.08,.35,.34,.39,"Stone")
        block("Pergola oak post",xx,-4.17,.47,.18,.18,2.17,"Beam")
        bar("Pergola side bearer",(xx,-4.36,2.64),(xx,-1.65,2.87),.15,.18,"Cedar")
    for i in range(8):
        yy=-4.32+i*.365
        zz=2.68+i*.032
        bar("Pergola joist",(-6.05,yy,zz),(-2.59,yy,zz),.084,.13,"Cedar")
    block("Lounge bench",-4.83,-3.49,.08,2.86,.80,.45,"Stone")
    block("Seat cushions",-4.83,-3.48,.53,2.70,.72,.14,"Linen",.06)
    block("Garden bed",-1.23,-2.65,.08,1.74,2.81,.18,"Earth")
    multi_stem_tree(-1.29,-2.81,.26,3.63)
    for i in range(6):
        shrub(6.6,-3.46+i*1.43,2.67,.87+(i%3)*.13,80+i,False)
    shrub(1.51,1.33,.30,.80,17)
    marker("Entrance",(3.46,-5.96,.07))
    marker("Shelter",(1.84,1.90,.30))


MODELS.mkdir(parents=True,exist_ok=True)
SOURCES.mkdir(parents=True,exist_ok=True)
ID='bridge-court'
title='双庭石居'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0
palette()
primary=bpy.context.scene
for NEAR in [True,False]:
    scene=primary if NEAR else bpy.data.scenes.new(title+" · Distant")
    bpy.context.window.scene=scene
    if NEAR:
        scene.name=title
    scene.unit_settings.system="METRIC"
    stone_house()
    path=MODELS/(ID+("" if NEAR else "_lod")+".glb")
    bpy.ops.export_scene.gltf(filepath=str(path),use_active_scene=True,export_apply=True,
        export_animations=False,export_cameras=False,export_lights=False)
bpy.context.window.scene=primary
bpy.data.libraries.write(str(SOURCES/(ID+".blend")),set(bpy.data.scenes),fake_user=True)
