set samples 120
set isosamples 60
set xrange [-4:4]
set yrange [-4:4]
set hidden3d front
set view 45, 75
set ztics .5
set key off
set contour base
set style arrow 1 filled lw 3 lc 'black'
# Arrows circling the ring 0.5 < x²+y² < 2, tangent to it, on the surface.
do for [i=0:15] {
  r = i < 8 ? 0.85 : 1.25
  t = 2*pi*(i % 8)/8 + (i < 8 ? 0 : pi/8)
  set arrow i+1 from r*cos(t), r*sin(t), besj0(r**2) \
      rto -.35*sin(t), .35*cos(t), 0 as 1 front
}
# The twist: a path read from a data file next to this post.
splot besj0(x**2+y**2), \
      "data/spiral.dat" using 1:2:3 with lines lw 3 lc 'red' nohidden3d nocontours